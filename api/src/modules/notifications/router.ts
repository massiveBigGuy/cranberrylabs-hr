import { Router } from 'express';
import type { AppContext } from '../types';
import type { NotificationService } from './service';
import { PushSubscriptionRepo } from './repo';

export function buildNotificationsRouter(
  ctx: AppContext,
  service: NotificationService,
): Router {
  const router = Router();
  const repo = new PushSubscriptionRepo(ctx.db);

  // GET /api/notifications/vapid-key — public VAPID key for frontend subscription setup
  router.get('/vapid-key', (_req, res) => {
    res.json({ enabled: service.isPushEnabled, vapid_public: service.vapidPublicKey });
  });

  // POST /api/notifications/subscribe — register a browser push subscription
  router.post('/subscribe', (req, res) => {
    if (!service.isPushEnabled) {
      res.status(501).json({ error: 'browser push is not configured on this server' });
      return;
    }
    const { endpoint, keys } = req.body ?? {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: 'endpoint, keys.p256dh, and keys.auth are required' });
      return;
    }
    const userId = req.user!.username;
    repo.upsert(userId, String(endpoint), String(keys.p256dh), String(keys.auth));
    res.status(201).json({ ok: true });
  });

  // DELETE /api/notifications/subscribe — unregister a push subscription by endpoint
  router.delete('/subscribe', (req, res) => {
    const { endpoint } = req.body ?? {};
    if (!endpoint) {
      res.status(400).json({ error: 'endpoint is required' });
      return;
    }
    const userId = req.user!.username;
    repo.remove(userId, String(endpoint));
    res.status(204).end();
  });

  // POST /api/notifications/test — fire a test notification to the requesting user
  router.post('/test', async (req, res) => {
    const userId = req.user!.username;
    const userSubs = repo.listForUser(userId);
    const webhooks = (ctx.config.notifications.channels ?? []).filter(
      (c) => c.type === 'webhook' && c.url,
    );
    if (userSubs.length === 0 && webhooks.length === 0) {
      res.status(400).json({
        error: 'no push subscriptions or webhooks configured',
      });
      return;
    }
    await service.sendQueueDrained({ timestamp: new Date().toISOString() });
    res.json({ ok: true });
  });

  return router;
}

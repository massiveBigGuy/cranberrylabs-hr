import webpush from 'web-push';
import type { AppConfig } from '../../config';
import type { PushSubscriptionRepo } from './repo';
import { createLogger } from '../../services/logger';

const log = createLogger('notifications');

export interface QueueDrainedPayload {
  timestamp: string;
}

export class NotificationService {
  private readonly pushEnabled: boolean;

  constructor(
    private readonly config: AppConfig,
    private readonly repo: PushSubscriptionRepo,
  ) {
    const push = config.notifications.push;
    this.pushEnabled = !!(push?.vapid_public && push?.vapid_private);
    if (this.pushEnabled && push) {
      webpush.setVapidDetails(
        push.vapid_subject,
        push.vapid_public,
        push.vapid_private,
      );
    }
  }

  get isPushEnabled(): boolean {
    return this.pushEnabled;
  }

  get vapidPublicKey(): string | null {
    return this.pushEnabled ? (this.config.notifications.push?.vapid_public ?? null) : null;
  }

  async sendQueueDrained(payload: QueueDrainedPayload): Promise<void> {
    await Promise.allSettled([
      this.sendWebhooks(payload),
      this.sendPushNotifications(payload),
    ]);
  }

  private async sendWebhooks(payload: QueueDrainedPayload): Promise<void> {
    const channels = this.config.notifications.channels ?? [];
    const webhooks = channels.filter((c) => c.type === 'webhook' && c.url);
    if (webhooks.length === 0) return;

    await Promise.allSettled(
      webhooks.map(async (ch) => {
        try {
          const res = await fetch(ch.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'queue.drained',
              timestamp: payload.timestamp,
              message: 'Application generation queue has completed.',
            }),
          });
          if (!res.ok) {
            log.warn('webhook delivery failed', { url: ch.url, status: res.status });
          } else {
            log.info('webhook delivered', { name: ch.name ?? ch.url });
          }
        } catch (err) {
          log.warn('webhook error', { url: ch.url, error: (err as Error).message });
        }
      }),
    );
  }

  private async sendPushNotifications(payload: QueueDrainedPayload): Promise<void> {
    if (!this.pushEnabled) return;

    const subscriptions = this.repo.listAll();
    if (subscriptions.length === 0) return;

    const notification = JSON.stringify({
      title: 'cranberrylabs HR',
      body: 'Application generation queue complete — check your applications.',
      timestamp: payload.timestamp,
    });

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            notification,
          );
          log.debug('push sent', { userId: sub.user_id });
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 410 || status === 404) {
            // Subscription expired — remove it so we stop hitting it.
            this.repo.remove(sub.user_id, sub.endpoint);
            log.info('push subscription expired, removed', { userId: sub.user_id });
          } else {
            log.warn('push send failed', {
              userId: sub.user_id,
              error: (err as Error).message,
            });
          }
        }
      }),
    );
  }
}

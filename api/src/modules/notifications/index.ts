import type { Module, AppContext } from '../types';
import { migrations } from './migrations';
import { PushSubscriptionRepo } from './repo';
import { NotificationService } from './service';
import { buildNotificationsRouter } from './router';
import { bus } from '../../services/sse/bus';

export const notificationsModule: Module = {
  name: 'notifications',
  version: '1.0.0',
  migrations,
  workers: [],
  scheduledTasks: [],
  init: async (ctx: AppContext) => {
    const repo = new PushSubscriptionRepo(ctx.db);
    const service = new NotificationService(ctx.config, repo);
    ctx.services.register('notification_service', service);

    notificationsModule.router = buildNotificationsRouter(ctx, service);

    // Subscribe to the SSE bus. When the generation queue drains, fan out to
    // all configured channels (webhooks + browser push subscriptions).
    // Using bus.on rather than direct coupling so the applications module
    // doesn't need to know the notifications module exists.
    bus.on('event', async (sseEvent) => {
      if (
        sseEvent.event === 'queue.drained' &&
        ctx.config.notifications.on_queue_complete
      ) {
        await service.sendQueueDrained({ timestamp: new Date().toISOString() });
      }
    });

    ctx.logger.debug('notifications module initialized', {
      push: service.isPushEnabled,
      webhooks: (ctx.config.notifications.channels ?? []).filter((c) => c.type === 'webhook')
        .length,
    });
  },
};

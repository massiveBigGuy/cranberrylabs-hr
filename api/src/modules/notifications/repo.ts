import type { DB } from '../../services/db';

export interface PushSubscription {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export class PushSubscriptionRepo {
  constructor(private readonly db: DB) {}

  upsert(userId: string, endpoint: string, p256dh: string, auth: string): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES (:user_id, :endpoint, :p256dh, :auth)
         ON CONFLICT(user_id, endpoint) DO UPDATE
           SET p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run({ user_id: userId, endpoint, p256dh, auth });
  }

  remove(userId: string, endpoint: string): void {
    this.db
      .prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
      .run(userId, endpoint);
  }

  listAll(): PushSubscription[] {
    return this.db
      .prepare('SELECT * FROM push_subscriptions')
      .all() as PushSubscription[];
  }

  listForUser(userId: string): PushSubscription[] {
    return this.db
      .prepare('SELECT * FROM push_subscriptions WHERE user_id = ?')
      .all(userId) as PushSubscription[];
  }
}

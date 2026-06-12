import type { Migration } from '../../services/db/migrations';

export const migrations: Migration[] = [
  {
    id: 'notifications_001_push_subscriptions',
    up: (db) => {
      db.exec(`
        CREATE TABLE push_subscriptions (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    TEXT NOT NULL,
          endpoint   TEXT NOT NULL,
          p256dh     TEXT NOT NULL,
          auth       TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, endpoint)
        );
        CREATE INDEX idx_push_subs_user ON push_subscriptions(user_id);
      `);
    },
  },
];

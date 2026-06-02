import type { Request, Response, NextFunction } from 'express';
import type { DB } from '../services/db';

export function makeUserProvisioner(db: DB) {
  return function userProvisioner(req: Request, _res: Response, next: NextFunction): void {
    const u = req.user;
    if (!u) return next();

    const row = db
      .prepare(
        `INSERT INTO users (username, email, display_name, last_seen_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(username) DO UPDATE SET
           email = excluded.email,
           display_name = excluded.display_name,
           last_seen_at = datetime('now')
         RETURNING role`,
      )
      .get(u.username, u.email ?? null, u.name ?? null) as { role: string } | undefined;

    if (row) u.role = row.role;
    next();
  };
}

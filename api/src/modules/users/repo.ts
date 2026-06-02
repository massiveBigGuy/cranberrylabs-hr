import type { DB } from '../../services/db';

export type UserRole = 'admin' | 'user' | 'viewer';

export interface UserRow {
  username: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
  created_at: string;
  last_seen_at: string | null;
}

const ALLOWED_ROLES: readonly UserRole[] = ['admin', 'user', 'viewer'];

export function isUserRole(s: unknown): s is UserRole {
  return typeof s === 'string' && (ALLOWED_ROLES as readonly string[]).includes(s);
}

export class UsersRepo {
  constructor(private readonly db: DB) {}

  upsert(username: string, email: string | null, displayName: string | null): UserRow {
    return this.db
      .prepare(
        `INSERT INTO users (username, email, display_name, last_seen_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(username) DO UPDATE SET
           email = excluded.email,
           display_name = excluded.display_name,
           last_seen_at = datetime('now')
         RETURNING *`,
      )
      .get(username, email, displayName) as UserRow;
  }

  get(username: string): UserRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM users WHERE username = ?')
        .get(username) as UserRow | undefined) ?? null
    );
  }

  list(): UserRow[] {
    return this.db
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all() as UserRow[];
  }

  updateRole(username: string, role: UserRole): UserRow | null {
    const info = this.db
      .prepare(`UPDATE users SET role = ? WHERE username = ?`)
      .run(role, username);
    if (!info.changes) return null;
    return this.get(username);
  }
}

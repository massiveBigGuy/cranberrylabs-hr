import type { DB } from '../../services/db';

export interface ProfileRow {
  id: number;
  user_id: string;
  name: string;
  target_keywords: string | null;    // JSON string[]
  excluded_keywords: string | null;  // JSON string[]
  resume_version_id: number | null;
  is_default: number;                // 0 | 1
  created_at: string;
  updated_at: string;
}

export interface NewProfileInput {
  name: string;
  target_keywords?: string[] | null;
  excluded_keywords?: string[] | null;
  resume_version_id?: number | null;
}

export interface ProfileUpdate {
  name?: string;
  target_keywords?: string[] | null;
  excluded_keywords?: string[] | null;
  resume_version_id?: number | null;
  is_default?: boolean;
}

export class ProfilesRepo {
  constructor(private readonly db: DB) {}

  list(userId: string): ProfileRow[] {
    return this.db
      .prepare(
        'SELECT * FROM profiles WHERE user_id = ? ORDER BY is_default DESC, name ASC',
      )
      .all(userId) as ProfileRow[];
  }

  get(id: number): ProfileRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM profiles WHERE id = ?')
        .get(id) as ProfileRow | undefined) ?? null
    );
  }

  getDefault(userId: string): ProfileRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM profiles WHERE user_id = ? AND is_default = 1')
        .get(userId) as ProfileRow | undefined) ?? null
    );
  }

  // Used by sources router to attach a new source to the right profile.
  getForSource(sourceId: number): ProfileRow | null {
    return (
      (this.db
        .prepare(
          `SELECT p.* FROM profiles p
           JOIN sources s ON s.profile_id = p.id
           WHERE s.id = ?`,
        )
        .get(sourceId) as ProfileRow | undefined) ?? null
    );
  }

  insert(userId: string, input: NewProfileInput): ProfileRow {
    return this.db
      .prepare(
        `INSERT INTO profiles (user_id, name, target_keywords, excluded_keywords, resume_version_id)
         VALUES (?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        userId,
        input.name,
        input.target_keywords != null ? JSON.stringify(input.target_keywords) : null,
        input.excluded_keywords != null ? JSON.stringify(input.excluded_keywords) : null,
        input.resume_version_id ?? null,
      ) as ProfileRow;
  }

  update(id: number, userId: string, patch: ProfileUpdate): ProfileRow | null {
    const existing = this.get(id);
    if (!existing || existing.user_id !== userId) return null;

    const tx = this.db.transaction(() => {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (patch.name !== undefined) {
        fields.push('name = ?');
        values.push(patch.name);
      }
      if (patch.target_keywords !== undefined) {
        fields.push('target_keywords = ?');
        values.push(
          patch.target_keywords != null ? JSON.stringify(patch.target_keywords) : null,
        );
      }
      if (patch.excluded_keywords !== undefined) {
        fields.push('excluded_keywords = ?');
        values.push(
          patch.excluded_keywords != null ? JSON.stringify(patch.excluded_keywords) : null,
        );
      }
      if (patch.resume_version_id !== undefined) {
        fields.push('resume_version_id = ?');
        values.push(patch.resume_version_id ?? null);
      }

      if (fields.length > 0) {
        fields.push("updated_at = datetime('now')");
        values.push(id);
        this.db
          .prepare(`UPDATE profiles SET ${fields.join(', ')} WHERE id = ?`)
          .run(...values);
      }

      if (patch.is_default === true) {
        // Clear is_default on all other profiles for this user, then set on this one.
        this.db
          .prepare(
            "UPDATE profiles SET is_default = 0, updated_at = datetime('now') WHERE user_id = ?",
          )
          .run(userId);
        this.db
          .prepare(
            "UPDATE profiles SET is_default = 1, updated_at = datetime('now') WHERE id = ?",
          )
          .run(id);
      }
    });

    tx();
    return this.get(id);
  }

  delete(id: number): boolean {
    return this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id).changes > 0;
  }

  // Atomically set a new default (clear old, set new) — used internally.
  setDefault(userId: string, profileId: number): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE profiles SET is_default = 0, updated_at = datetime('now') WHERE user_id = ?",
        )
        .run(userId);
      this.db
        .prepare(
          "UPDATE profiles SET is_default = 1, updated_at = datetime('now') WHERE id = ?",
        )
        .run(profileId);
    });
    tx();
  }

  countSources(profileId: number): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) as n FROM sources WHERE profile_id = ?')
        .get(profileId) as { n: number }
    ).n;
  }

  countJobs(profileId: number): number {
    return (
      this.db
        .prepare(
          'SELECT COUNT(*) as n FROM jobs WHERE source_id IN (SELECT id FROM sources WHERE profile_id = ?)',
        )
        .get(profileId) as { n: number }
    ).n;
  }

  countWritingSamples(profileId: number): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) as n FROM writing_samples WHERE profile_id = ?')
        .get(profileId) as { n: number }
    ).n;
  }
}

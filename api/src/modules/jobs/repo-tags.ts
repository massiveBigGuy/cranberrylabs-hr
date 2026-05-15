import type { DB } from '../../services/db';

export interface TagRow {
  id: number;
  name: string;
  color: string | null;
}

export class TagsRepo {
  constructor(private readonly db: DB) {}

  /**
   * Find-or-create. Tag names are case-sensitive in the DB (UNIQUE on name),
   * but we trim and lowercase here so 'Remote', 'remote', and ' remote '
   * all collapse to one row. This matches user expectations for free-form
   * tag input and is reversible if we ever want case-preserving display
   * names (add a display_name column).
   */
  upsert(rawName: string, color?: string | null): TagRow {
    const name = rawName.trim().toLowerCase();
    if (!name) throw new Error('tag name required');
    if (name.length > 64) throw new Error('tag name too long (max 64)');

    const existing = this.db.prepare('SELECT * FROM tags WHERE name = ?').get(name) as
      | TagRow
      | undefined;
    if (existing) return existing;

    const info = this.db
      .prepare('INSERT INTO tags (name, color) VALUES (?, ?)')
      .run(name, color ?? null);
    return { id: Number(info.lastInsertRowid), name, color: color ?? null };
  }

  list(): TagRow[] {
    return this.db.prepare('SELECT * FROM tags ORDER BY name ASC').all() as TagRow[];
  }

  findByName(name: string): TagRow | null {
    const row = this.db
      .prepare('SELECT * FROM tags WHERE name = ?')
      .get(name.trim().toLowerCase()) as TagRow | undefined;
    return row ?? null;
  }

  attach(jobId: number, tagId: number): void {
    // INSERT OR IGNORE keeps re-tagging idempotent — calling POST /tags
    // with the same tag twice is a no-op rather than a 500.
    this.db
      .prepare('INSERT OR IGNORE INTO job_tags (job_id, tag_id) VALUES (?, ?)')
      .run(jobId, tagId);
  }

  detach(jobId: number, tagId: number): boolean {
    const info = this.db
      .prepare('DELETE FROM job_tags WHERE job_id = ? AND tag_id = ?')
      .run(jobId, tagId);
    return info.changes > 0;
  }
}

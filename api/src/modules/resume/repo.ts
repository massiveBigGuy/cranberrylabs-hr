import type { DB } from '../../services/db';

export interface MasterResumeRow {
  id: number;
  user_id: string;
  version: number;
  content: string;
  notes: string | null;
  is_active: number;  // 0 | 1
  created_at: string;
}

export type WritingSampleKind = 'cover_letter' | 'email' | 'bio' | 'other';

const ALLOWED_KINDS: readonly WritingSampleKind[] = ['cover_letter', 'email', 'bio', 'other'];
export function isWritingSampleKind(s: unknown): s is WritingSampleKind {
  return typeof s === 'string' && (ALLOWED_KINDS as readonly string[]).includes(s);
}

export interface WritingSampleRow {
  id: number;
  user_id: string;
  label: string;
  kind: string;
  content: string;
  active: number;  // 0 | 1
  profile_id: number | null;
  created_at: string;
}

export class ResumeRepo {
  constructor(private readonly db: DB) {}

  // Unscoped — used by the worker to load a pinned resume version by ID.
  getById(id: number): MasterResumeRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM master_resume WHERE id = ?')
        .get(id) as MasterResumeRow | undefined) ?? null
    );
  }

  getActive(userId: string): MasterResumeRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM master_resume WHERE is_active = 1 AND user_id = ?')
        .get(userId) as MasterResumeRow | undefined) ?? null
    );
  }

  listVersions(userId: string): MasterResumeRow[] {
    return this.db
      .prepare('SELECT * FROM master_resume WHERE user_id = ? ORDER BY version DESC')
      .all(userId) as MasterResumeRow[];
  }

  create(content: string, notes: string | null, userId: string): MasterResumeRow {
    const { v } = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM master_resume WHERE user_id = ?')
      .get(userId) as { v: number };
    return this.db
      .prepare(
        'INSERT INTO master_resume (user_id, version, content, notes, is_active) VALUES (?, ?, ?, ?, 0) RETURNING *',
      )
      .get(userId, v + 1, content, notes ?? null) as MasterResumeRow;
  }

  activate(id: number, userId: string): MasterResumeRow | null {
    const exists = this.db
      .prepare('SELECT id FROM master_resume WHERE id = ? AND user_id = ?')
      .get(id, userId) as { id: number } | undefined;
    if (!exists) return null;

    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE master_resume SET is_active = 0 WHERE user_id = ?')
        .run(userId);
      this.db
        .prepare('UPDATE master_resume SET is_active = 1 WHERE id = ?')
        .run(id);
    });
    tx();

    return this.db
      .prepare('SELECT * FROM master_resume WHERE id = ?')
      .get(id) as MasterResumeRow;
  }

  // --- Writing samples ---

  listWritingSamples(userId: string, profileId?: number): WritingSampleRow[] {
    if (profileId !== undefined) {
      return this.db
        .prepare(
          'SELECT * FROM writing_samples WHERE user_id = ? AND profile_id = ? ORDER BY created_at DESC',
        )
        .all(userId, profileId) as WritingSampleRow[];
    }
    return this.db
      .prepare('SELECT * FROM writing_samples WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as WritingSampleRow[];
  }

  createWritingSample(
    label: string,
    kind: string,
    content: string,
    userId: string,
    profileId?: number | null,
  ): WritingSampleRow {
    return this.db
      .prepare(
        'INSERT INTO writing_samples (user_id, label, kind, content, profile_id) VALUES (?, ?, ?, ?, ?) RETURNING *',
      )
      .get(userId, label, kind, content, profileId ?? null) as WritingSampleRow;
  }

  updateWritingSample(
    id: number,
    patch: { label?: string; kind?: string; content?: string; active?: number },
    userId: string,
  ): WritingSampleRow | null {
    const existing = this.db
      .prepare('SELECT * FROM writing_samples WHERE id = ? AND user_id = ?')
      .get(id, userId) as WritingSampleRow | undefined;
    if (!existing) return null;

    const label = patch.label ?? existing.label;
    const kind = patch.kind ?? existing.kind;
    const content = patch.content ?? existing.content;
    const active = patch.active ?? existing.active;

    this.db
      .prepare(
        'UPDATE writing_samples SET label = ?, kind = ?, content = ?, active = ? WHERE id = ?',
      )
      .run(label, kind, content, active, id);

    return this.db
      .prepare('SELECT * FROM writing_samples WHERE id = ?')
      .get(id) as WritingSampleRow;
  }

  deleteWritingSample(id: number, userId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM writing_samples WHERE id = ? AND user_id = ?')
      .run(id, userId);
    return result.changes > 0;
  }
}

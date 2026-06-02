import type { DB } from '../../services/db';

export interface MasterResumeRow {
  id: number;
  version: number;
  content: string;  // structured JSON — see §6 of schema-v2.md
  notes: string | null;
  is_active: number;  // 0 | 1 — SQLite has no boolean
  created_at: string;
}

export type WritingSampleKind = 'cover_letter' | 'email' | 'bio' | 'other';

const ALLOWED_KINDS: readonly WritingSampleKind[] = ['cover_letter', 'email', 'bio', 'other'];
export function isWritingSampleKind(s: unknown): s is WritingSampleKind {
  return typeof s === 'string' && (ALLOWED_KINDS as readonly string[]).includes(s);
}

export interface WritingSampleRow {
  id: number;
  label: string;
  kind: string;
  content: string;
  active: number;  // 0 | 1
  created_at: string;
}

export class ResumeRepo {
  constructor(private readonly db: DB) {}

  getActive(): MasterResumeRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM master_resume WHERE is_active = 1')
        .get() as MasterResumeRow | undefined) ?? null
    );
  }

  listVersions(): MasterResumeRow[] {
    return this.db
      .prepare('SELECT * FROM master_resume ORDER BY version DESC')
      .all() as MasterResumeRow[];
  }

  create(content: string, notes: string | null): MasterResumeRow {
    const { v } = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM master_resume')
      .get() as { v: number };
    return this.db
      .prepare(
        'INSERT INTO master_resume (version, content, notes, is_active) VALUES (?, ?, ?, 0) RETURNING *',
      )
      .get(v + 1, content, notes ?? null) as MasterResumeRow;
  }

  activate(id: number): MasterResumeRow | null {
    const exists = this.db
      .prepare('SELECT id FROM master_resume WHERE id = ?')
      .get(id) as { id: number } | undefined;
    if (!exists) return null;

    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE master_resume SET is_active = 0').run();
      this.db.prepare('UPDATE master_resume SET is_active = 1 WHERE id = ?').run(id);
    });
    tx();

    return this.db
      .prepare('SELECT * FROM master_resume WHERE id = ?')
      .get(id) as MasterResumeRow;
  }

  // --- Writing samples ---

  listWritingSamples(): WritingSampleRow[] {
    return this.db
      .prepare('SELECT * FROM writing_samples ORDER BY created_at DESC')
      .all() as WritingSampleRow[];
  }

  createWritingSample(label: string, kind: string, content: string): WritingSampleRow {
    return this.db
      .prepare(
        'INSERT INTO writing_samples (label, kind, content) VALUES (?, ?, ?) RETURNING *',
      )
      .get(label, kind, content) as WritingSampleRow;
  }

  updateWritingSample(
    id: number,
    patch: { label?: string; kind?: string; content?: string; active?: number },
  ): WritingSampleRow | null {
    const existing = this.db
      .prepare('SELECT * FROM writing_samples WHERE id = ?')
      .get(id) as WritingSampleRow | undefined;
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

  deleteWritingSample(id: number): boolean {
    const result = this.db.prepare('DELETE FROM writing_samples WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

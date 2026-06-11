import type { DB } from '../../services/db';

export type Platform = 'workday' | 'greenhouse' | 'lever' | 'icims' | 'custom' | 'manual';
export type SourceStatus = 'ok' | 'blocked' | 'error' | null;

export interface SourceRow {
  id: number;
  user_id: string;
  company_name: string;
  platform: Platform;
  tenant_url: string;
  search_params: string | null;
  enabled: 0 | 1;
  last_scraped_at: string | null;
  last_status: SourceStatus;
  last_error: string | null;
  profile_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface NewSourceInput {
  company_name: string;
  platform: Platform;
  tenant_url: string;
  search_params?: object | null;
  profile_id?: number | null;
}

export interface SourceUpdate {
  company_name?: string;
  enabled?: boolean;
  search_params?: object | null;
  profile_id?: number | null;
}

export interface ProbeResultUpdate {
  last_status: SourceStatus;
  last_error: string | null;
  last_scraped_at?: string;
}

export class SourcesRepo {
  constructor(private readonly db: DB) {}

  list(userId: string): SourceRow[] {
    return this.db
      .prepare('SELECT * FROM sources WHERE user_id = ? ORDER BY company_name ASC')
      .all(userId) as SourceRow[];
  }

  get(id: number): SourceRow | null {
    return (
      (this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined) ??
      null
    );
  }

  findByTenantUrl(url: string, userId: string): SourceRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM sources WHERE tenant_url = ? AND user_id = ?')
        .get(url, userId) as SourceRow | undefined) ?? null
    );
  }

  insert(input: NewSourceInput, userId: string): SourceRow {
    const stmt = this.db.prepare(`
      INSERT INTO sources (company_name, platform, tenant_url, search_params, user_id, profile_id)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    return stmt.get(
      input.company_name,
      input.platform,
      input.tenant_url,
      input.search_params == null ? null : JSON.stringify(input.search_params),
      userId,
      input.profile_id ?? null,
    ) as SourceRow;
  }

  update(id: number, patch: SourceUpdate): SourceRow | null {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.company_name !== undefined) {
      fields.push('company_name = ?');
      values.push(patch.company_name);
    }
    if (patch.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    if (patch.search_params !== undefined) {
      fields.push('search_params = ?');
      values.push(patch.search_params == null ? null : JSON.stringify(patch.search_params));
    }
    if (patch.profile_id !== undefined) {
      fields.push('profile_id = ?');
      values.push(patch.profile_id ?? null);
    }
    if (fields.length === 0) return this.get(id);
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE sources SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.get(id);
  }

  delete(id: number): boolean {
    const info = this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    return info.changes > 0;
  }

  recordProbeResult(id: number, result: ProbeResultUpdate): void {
    const fields: string[] = ['last_status = ?', 'last_error = ?'];
    const values: unknown[] = [result.last_status, result.last_error];
    if (result.last_scraped_at !== undefined) {
      fields.push('last_scraped_at = ?');
      values.push(result.last_scraped_at);
    }
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE sources SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}

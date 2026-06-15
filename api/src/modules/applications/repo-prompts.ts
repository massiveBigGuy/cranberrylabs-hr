import type { Database as DB } from 'better-sqlite3';

export interface SavedPrompt {
  id: number;
  user_id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export class SavedPromptsRepo {
  constructor(private db: DB) {}

  list(userId: string): SavedPrompt[] {
    return this.db
      .prepare('SELECT * FROM saved_prompts WHERE user_id = ? ORDER BY name ASC')
      .all(userId) as SavedPrompt[];
  }

  get(id: number, userId: string): SavedPrompt | undefined {
    return this.db
      .prepare('SELECT * FROM saved_prompts WHERE id = ? AND user_id = ?')
      .get(id, userId) as SavedPrompt | undefined;
  }

  getByName(userId: string, name: string): SavedPrompt | undefined {
    return this.db
      .prepare('SELECT * FROM saved_prompts WHERE user_id = ? AND name = ?')
      .get(userId, name) as SavedPrompt | undefined;
  }

  create(userId: string, name: string, content: string): SavedPrompt {
    return this.db
      .prepare(
        `INSERT INTO saved_prompts (user_id, name, content) VALUES (?, ?, ?) RETURNING *`,
      )
      .get(userId, name, content) as SavedPrompt;
  }

  update(
    id: number,
    userId: string,
    fields: { name?: string; content?: string },
  ): SavedPrompt | undefined {
    const parts: string[] = [`updated_at = datetime('now')`];
    const params: Record<string, unknown> = { id, userId };

    if (fields.name !== undefined) {
      parts.push('name = :name');
      params.name = fields.name;
    }
    if (fields.content !== undefined) {
      parts.push('content = :content');
      params.content = fields.content;
    }

    return this.db
      .prepare(
        `UPDATE saved_prompts SET ${parts.join(', ')} WHERE id = :id AND user_id = :userId RETURNING *`,
      )
      .get(params) as SavedPrompt | undefined;
  }

  delete(id: number, userId: string): boolean {
    const result = this.db
      .prepare('DELETE FROM saved_prompts WHERE id = ? AND user_id = ?')
      .run(id, userId);
    return result.changes > 0;
  }
}

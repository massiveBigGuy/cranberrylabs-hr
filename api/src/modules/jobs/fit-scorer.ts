/**
 * Fit scoring v1 — keyword-based, deterministic.
 *
 * Score is 0.0–1.0:
 *   - Any excluded keyword match in title or description → 0.0
 *   - Each signal keyword matching the title contributes 0.5
 *   - Each signal keyword matching the description (but not title) contributes 0.15
 *   - Capped at 1.0
 *
 * Rationale for weights: a title hit is a very strong signal (the
 * company described the role using your exact term), while a description
 * hit is weaker (the term appears somewhere in a wall of JD text).
 * Two title hits → cap of 1.0 so the scoring stays legible.
 *
 * `reasons` is a string array for storage as JSON in `jobs.fit_reasons`.
 * Format: 'title:sysadmin' or 'desc:infrastructure engineer'.
 */

const TITLE_WEIGHT = 0.5;
const DESC_WEIGHT = 0.15;

export interface FitResult {
  score: number;
  reasons: string[];
}

export function computeFitScore(
  job: { title: string; description: string },
  signals: string[],
  excludes: string[],
): FitResult {
  const title = job.title.toLowerCase();
  const desc = job.description.toLowerCase();

  for (const kw of excludes) {
    const k = kw.toLowerCase();
    if (title.includes(k) || desc.includes(k)) {
      return { score: 0, reasons: [`excluded:${kw}`] };
    }
  }

  if (signals.length === 0) {
    return { score: 0, reasons: [] };
  }

  const reasons: string[] = [];
  let raw = 0;

  for (const kw of signals) {
    const k = kw.toLowerCase();
    if (title.includes(k)) {
      raw += TITLE_WEIGHT;
      reasons.push(`title:${kw}`);
    } else if (desc.includes(k)) {
      raw += DESC_WEIGHT;
      reasons.push(`desc:${kw}`);
    }
  }

  return { score: Math.min(1.0, raw), reasons };
}

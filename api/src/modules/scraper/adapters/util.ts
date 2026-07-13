/**
 * Small helpers shared across the one-phase adapters (Greenhouse, Lever,
 * Ashby). Workday keeps its own inline copies — not touched here — since
 * it predates this file and there's no reason to churn a working adapter
 * just to share three lines.
 */
import crypto from 'node:crypto';

export function hashDescription(text: string): string {
  return text ? crypto.createHash('sha256').update(text).digest('hex') : '';
}

export class HttpError extends Error {
  constructor(message: string, public httpStatus: number) {
    super(message);
    this.name = 'HttpError';
  }
}

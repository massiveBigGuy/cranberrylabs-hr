import type { GenerationRequest } from './types';

export const SYSTEM_PROMPT = `You are an expert resume and cover letter writer helping a job seeker tailor their application materials.

You will receive a job posting, a master resume in JSON format, and optional writing samples for voice calibration.

Your task is to:
1. Write a targeted, professional cover letter in the candidate's voice (3-4 paragraphs, under 450 words). Avoid generic openers like "I am writing to express my interest."
2. Return a tailored version of the master resume JSON. You may reorder, emphasize, or lightly rephrase existing content only — do not invent qualifications or experiences not present in the original.

Return exactly two sections delimited by XML tags and nothing else:

<cover_letter>
[your cover letter here]
</cover_letter>

<tailored_resume>
[valid JSON here — must be parseable]
</tailored_resume>`;

export function buildFeedbackBlock(req: GenerationRequest): string {
  const hasFeedback = req.accumulatedFeedback && req.accumulatedFeedback.length > 0;
  const hasPrevious = req.previousOutput != null;
  if (!hasPrevious && !hasFeedback) return '';

  const parts: string[] = ['\n---\n'];
  if (hasPrevious) {
    parts.push(
      `PREVIOUS COVER LETTER (your last output):\n${req.previousOutput!.coverLetter}`,
      `\n---\n\nPREVIOUS TAILORED RESUME (your last output, JSON):\n${JSON.stringify(req.previousOutput!.tailoredResume, null, 2)}`,
    );
  }
  if (hasFeedback) {
    const notes = req.accumulatedFeedback!
      .map((note, i) => `${i + 1}. ${note}`)
      .join('\n');
    parts.push(`\n---\n\nREVISION FEEDBACK (apply all, oldest first):\n${notes}`);
  }
  parts.push('\n');
  return parts.join('\n');
}

export function extractTag(text: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start === -1 || end === -1) return null;
  return text.slice(start + open.length, end).trim();
}

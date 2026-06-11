import type { LLMAdapter, GenerationRequest, GenerationResult } from './types';

const SYSTEM_PROMPT = `You are an expert resume and cover letter writer helping a job seeker tailor their application materials.

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

function extractTag(text: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start === -1 || end === -1) return null;
  return text.slice(start + open.length, end).trim();
}

export class OllamaAdapter implements LLMAdapter {
  readonly name = 'ollama';
  private readonly config: { base_url: string; model: string };

  constructor(config: { base_url: string; model: string }) {
    this.config = config;
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const model = req.model ?? this.config.model;
    const baseUrl = this.config.base_url.replace(/\/$/, '');

    const samplesBlock =
      req.writingSamples.length > 0
        ? req.writingSamples
            .map((s) => `[${s.label} — ${s.kind}]\n${s.content}`)
            .join('\n\n---\n\n')
        : '(no writing samples provided)';

    const userMessage = `Job: ${req.jobTitle} at ${req.company}

---

JOB DESCRIPTION:
${req.jobDescription}

---

MASTER RESUME (JSON):
${JSON.stringify(req.masterResume, null, 2)}

---

WRITING SAMPLES (for voice calibration):
${samplesBlock}

---

Generate the cover letter and tailored resume now.`;

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Ollama API error ${response.status}: ${errorText.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      model: string;
      message: { role: string; content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const text = data.message?.content;
    if (!text) {
      throw new Error('Ollama returned an empty response');
    }

    const coverLetter = extractTag(text, 'cover_letter');
    if (!coverLetter) {
      throw new Error('LLM response is missing the <cover_letter> section');
    }

    const resumeRaw = extractTag(text, 'tailored_resume');
    if (!resumeRaw) {
      throw new Error('LLM response is missing the <tailored_resume> section');
    }

    let tailoredResume: Record<string, unknown>;
    try {
      tailoredResume = JSON.parse(resumeRaw);
    } catch (err) {
      throw new Error(
        `LLM returned invalid JSON in <tailored_resume>: ${(err as Error).message}`,
      );
    }

    return {
      coverLetter,
      tailoredResume,
      modelUsed: `ollama/${model}`,
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
    };
  }
}

import Anthropic from '@anthropic-ai/sdk';
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

export class AnthropicAdapter implements LLMAdapter {
  readonly name = 'anthropic';
  private readonly config: { model: string; max_tokens: number };

  constructor(config: { model: string; max_tokens: number }) {
    this.config = config;
  }

  private makeClient(): Anthropic {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is not set. ' +
          'Set it in docker-compose.yml or the environment before generating.',
      );
    }
    return new Anthropic({ apiKey });
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const client = this.makeClient();
    const model = req.model ?? this.config.model;

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

    const message = await client.messages.create({
      model,
      max_tokens: this.config.max_tokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const rawContent = message.content[0];
    if (rawContent.type !== 'text') {
      throw new Error(`Unexpected content type from Anthropic: ${rawContent.type}`);
    }
    const text = rawContent.text;

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
      modelUsed: model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  }
}

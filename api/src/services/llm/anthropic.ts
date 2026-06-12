import Anthropic from '@anthropic-ai/sdk';
import type { LLMAdapter, GenerationRequest, GenerationResult } from './types';
import { SYSTEM_PROMPT, buildFeedbackBlock, extractTag } from './utils';

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

    const feedbackBlock = buildFeedbackBlock(req);

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
${feedbackBlock}
---

${feedbackBlock ? 'Revise the cover letter and tailored resume to address all feedback notes above, keeping unchanged anything not mentioned.' : 'Generate the cover letter and tailored resume now.'}`;

    const system = req.systemPrompt ?? SYSTEM_PROMPT;

    const message = await client.messages.create({
      model,
      max_tokens: this.config.max_tokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });

    const rawContent = message.content[0];
    if (!rawContent) {
      throw new Error('Anthropic returned an empty response');
    }
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

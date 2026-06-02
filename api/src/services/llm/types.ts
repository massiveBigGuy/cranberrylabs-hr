export interface GenerationRequest {
  jobTitle: string;
  company: string;
  jobDescription: string;
  masterResume: Record<string, unknown>;
  writingSamples: Array<{ kind: string; label: string; content: string }>;
  model?: string;
}

export interface GenerationResult {
  coverLetter: string;
  tailoredResume: Record<string, unknown>;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LLMAdapter {
  readonly name: string;
  generate(req: GenerationRequest): Promise<GenerationResult>;
}

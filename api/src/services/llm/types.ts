export interface GenerationRequest {
  jobTitle: string;
  company: string;
  jobDescription: string;
  masterResume: Record<string, unknown>;
  writingSamples: Array<{ kind: string; label: string; content: string }>;
  model?: string;
  // Set on regeneration. The adapter folds these into the prompt so the model
  // sees the latest draft and the accumulated steering without replaying a full
  // conversation transcript. Both fields are absent on first-generation calls.
  previousOutput?: {
    coverLetter: string;
    tailoredResume: Record<string, unknown>;
  };
  accumulatedFeedback?: string[];  // oldest → newest
  systemPrompt?: string;           // overrides the default SYSTEM_PROMPT when present
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

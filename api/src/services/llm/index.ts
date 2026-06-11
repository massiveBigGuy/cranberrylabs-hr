import type { AppConfig } from '../../config';
import { AnthropicAdapter } from './anthropic';
import { OllamaAdapter } from './ollama';

export type { LLMAdapter, GenerationRequest, GenerationResult } from './types';

export function buildLLMAdapter(config: AppConfig) {
  const name = config.llm.default_adapter;
  switch (name) {
    case 'anthropic':
      return new AnthropicAdapter(config.llm.anthropic);
    case 'ollama':
      return new OllamaAdapter(config.llm.ollama);
    default:
      throw new Error(`Unknown LLM adapter: ${name}`);
  }
}

import type { AppConfig } from '../../config';
import { AnthropicAdapter } from './anthropic';

export type { LLMAdapter, GenerationRequest, GenerationResult } from './types';

export function buildLLMAdapter(config: AppConfig) {
  const name = config.llm.default_adapter;
  switch (name) {
    case 'anthropic':
      return new AnthropicAdapter(config.llm.anthropic);
    case 'ollama':
      throw new Error('Ollama adapter is not yet implemented (planned for step 8)');
    default:
      throw new Error(`Unknown LLM adapter: ${name}`);
  }
}

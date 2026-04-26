/**
 * OpenClaw Memory Embedding Provider Adapter for bge-large-zh-v1.5 ONNX
 */

import { embedText } from './onnx-runtime.js';

const PROVIDER_ID = 'onnx-bge-local';
const DEFAULT_MODEL = 'bge-large-zh-v1.5';

export const onnxBgeMemoryEmbeddingProviderAdapter = {
  id: PROVIDER_ID,
  defaultModel: DEFAULT_MODEL,
  transport: 'local',
  // Lower priority = selected first. openai=20, local=10, gemini=30, voyage=40
  // Set to 5 so this local ONNX provider auto-selects before all cloud providers
  autoSelectPriority: 5,
  shouldContinueAutoSelection: () => true,

  create: async (options) => {
    const provider = {
      id: PROVIDER_ID,
      model: DEFAULT_MODEL,

      embedQuery: async (text) => {
        return await embedText(text);
      },

      embedBatch: async (texts) => {
        return await Promise.all(texts.map(t => embedText(t)));
      }
    };

    return {
      provider,
      runtime: {
        id: PROVIDER_ID,
        cacheKeyData: {
          provider: PROVIDER_ID,
          model: DEFAULT_MODEL
        }
      }
    };
  }
};

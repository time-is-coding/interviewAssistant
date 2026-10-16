import type { FastifyPluginAsync } from 'fastify';

import { PROVIDER_PRESETS } from '../llm/presets.js';
import { testConnection } from '../llm/provider.js';
import {
  mergeForTest,
  readLlmConfig,
  toPublic,
  writeLlmConfig,
  type LlmConfigInput,
} from '../services/llmConfig.js';

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/settings/llm', async () => ({
    presets: PROVIDER_PRESETS,
    config: toPublic(readLlmConfig()),
  }));

  app.put<{ Body: LlmConfigInput }>('/settings/llm', async (req) => {
    const saved = writeLlmConfig(req.body ?? {});
    return { config: toPublic(saved) };
  });

  app.post<{ Body: LlmConfigInput }>('/settings/llm/test', async (req) => {
    const cfg = mergeForTest(req.body ?? {});
    const result = await testConnection(cfg);
    return result;
  });
};

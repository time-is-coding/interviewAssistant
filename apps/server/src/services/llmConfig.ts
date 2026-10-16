/**
 * LLM 配置的读写。
 *
 * 存储取舍：API Key 以明文存在本地 SQLite 里。这是本地单用户应用，
 * 换取的是「不用改配置文件、不用重启」的便利；但接口永远不下发明文 Key，
 * 只回掩码，请求由服务端携带。
 */
import { getConfig, setConfig } from '../db/index.js';
import { DEFAULT_LLM_CONFIG, type LlmConfig } from '../llm/provider.js';

const CONFIG_KEY = 'llm.config';

export function readLlmConfig(): LlmConfig {
  const stored = getConfig<Partial<LlmConfig>>(CONFIG_KEY);
  return { ...DEFAULT_LLM_CONFIG, ...stored };
}

export interface LlmConfigInput {
  presetId?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  /** 省略表示「保持原 Key 不变」；传字符串（含空串）表示替换。 */
  apiKey?: string;
}

export function writeLlmConfig(input: LlmConfigInput): LlmConfig {
  const current = readLlmConfig();
  const next: LlmConfig = {
    presetId: input.presetId ?? current.presetId,
    baseUrl: input.baseUrl ?? current.baseUrl,
    model: input.model ?? current.model,
    temperature: input.temperature ?? current.temperature,
    apiKey: input.apiKey === undefined ? current.apiKey : input.apiKey,
  };
  setConfig(CONFIG_KEY, next);
  return next;
}

/** 用已保存的配置补齐一次性的测试请求（测试时可以先不保存就试连）。 */
export function mergeForTest(input: LlmConfigInput): LlmConfig {
  const current = readLlmConfig();
  return {
    presetId: input.presetId ?? current.presetId,
    baseUrl: input.baseUrl ?? current.baseUrl,
    model: input.model ?? current.model,
    temperature: input.temperature ?? current.temperature,
    apiKey: input.apiKey === undefined ? current.apiKey : input.apiKey,
  };
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '****';
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}

/** 下发给前端的形态：不含明文 Key。 */
export interface PublicLlmConfig extends Omit<LlmConfig, 'apiKey'> {
  apiKeyMasked: string;
  hasApiKey: boolean;
}

export function toPublic(config: LlmConfig): PublicLlmConfig {
  const { apiKey, ...rest } = config;
  return {
    ...rest,
    apiKeyMasked: maskApiKey(apiKey),
    hasApiKey: apiKey.trim().length > 0,
  };
}

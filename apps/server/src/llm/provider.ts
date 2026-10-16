/**
 * OpenAI 兼容协议适配器。
 *
 * 不引官方 SDK —— Ollama、DeepSeek、通义、Kimi、智谱都支持同一套 /chat/completions，
 * 用原生 fetch 即可，少一个依赖，也少一层版本兼容问题。
 */
import type { ProviderPreset } from './presets.js';

export interface LlmConfig {
  /** 供应商预设 id，仅用于展示与回填 baseUrl。 */
  presetId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 面试用默认 0.7；评分报告会用 0.2。 */
  temperature: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  presetId: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
  apiKey: '',
  model: 'qwen2.5:7b',
  temperature: 0.7,
};

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function url(baseUrl: string, path: string): string {
  return `${normalizeBase(baseUrl)}${path}`;
}

function headers(cfg: LlmConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey.trim()) h.Authorization = `Bearer ${cfg.apiKey.trim()}`;
  return h;
}

/** 把上游返回的错误体裁成一句话，避免把整页 HTML 甩给前端。 */
async function describeFailure(res: Response): Promise<string> {
  let body = '';
  try {
    body = await res.text();
  } catch {
    /* 忽略 */
  }
  const trimmed = body.trim().slice(0, 300);
  try {
    const json = JSON.parse(trimmed) as { error?: { message?: string } | string; message?: string };
    const msg =
      typeof json.error === 'string' ? json.error : (json.error?.message ?? json.message);
    if (msg) return msg;
  } catch {
    /* 不是 JSON，用原文 */
  }
  return trimmed || res.statusText;
}

function assertConfigured(cfg: LlmConfig): void {
  if (!cfg.baseUrl.trim()) throw new LlmError('未配置 baseUrl');
  if (!cfg.model.trim()) throw new LlmError('未配置模型名');
}

export function describePreset(preset: ProviderPreset): string {
  return preset.requiresKey ? `${preset.name}（需要 API Key）` : preset.name;
}

/* ------------------------------------------------------------------ */
/* 非流式                                                              */
/* ------------------------------------------------------------------ */

export async function chat(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  assertConfigured(cfg);
  const res = await fetch(url(cfg.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts.temperature ?? cfg.temperature,
      max_tokens: opts.maxTokens,
      stream: false,
    }),
    signal: opts.signal ?? AbortSignal.timeout(180_000),
  });

  if (!res.ok) {
    throw new LlmError(`模型调用失败（HTTP ${res.status}）`, res.status, await describeFailure(res));
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new LlmError('模型返回内容为空', undefined, JSON.stringify(json).slice(0, 300));
  }
  return content;
}

/* ------------------------------------------------------------------ */
/* 流式                                                                */
/* ------------------------------------------------------------------ */

/**
 * 逐段产出模型回复的增量文本。
 * 上游按 SSE 返回，这里手工按行解析 —— 不引 eventsource 之类的库。
 */
export async function* chatStream(
  cfg: LlmConfig,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string, void, undefined> {
  assertConfigured(cfg);
  const res = await fetch(url(cfg.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: opts.temperature ?? cfg.temperature,
      max_tokens: opts.maxTokens,
      stream: true,
    }),
    signal: opts.signal ?? AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    throw new LlmError(`模型调用失败（HTTP ${res.status}）`, res.status, await describeFailure(res));
  }
  if (!res.body) throw new LlmError('模型未返回流式响应体');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineAt: number;
      while ((newlineAt = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineAt).trim();
        buffer = buffer.slice(newlineAt + 1);
        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        if (!payload) continue;

        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string | null } }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // 上游偶尔会插入非 JSON 的心跳行，忽略即可
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* 连接测试                                                            */
/* ------------------------------------------------------------------ */

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  models?: string[];
  error?: string;
}

/** 拉取可用模型列表。部分服务不实现 /models，此时返回 undefined 而不算失败。 */
async function listModels(cfg: LlmConfig): Promise<string[] | undefined> {
  const res = await fetch(url(cfg.baseUrl, '/models'), {
    headers: headers(cfg),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const ids = (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
  return ids.length > 0 ? ids.sort() : undefined;
}

/**
 * 测试连接。
 * 先试 /models（能顺带拿到模型列表）；服务不支持时退化为一次最小 chat 请求探活。
 */
export async function testConnection(cfg: LlmConfig): Promise<TestResult> {
  const started = Date.now();
  try {
    assertConfigured(cfg);

    const models = await listModels(cfg);
    if (models) {
      return { ok: true, latencyMs: Date.now() - started, models };
    }

    await chat(cfg, [{ role: 'user', content: 'hi' }], {
      maxTokens: 1,
      temperature: 0,
      signal: AbortSignal.timeout(30_000),
    });
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    const latencyMs = Date.now() - started;
    if (err instanceof LlmError) {
      return { ok: false, latencyMs, error: err.detail ? `${err.message}：${err.detail}` : err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    // fetch 连不上时 Node 只给 "fetch failed"，补一句更可操作的提示
    const hint = /fetch failed|ECONNREFUSED/i.test(message)
      ? `无法连接到 ${cfg.baseUrl}，请确认服务已启动（本地 Ollama 需先运行 ollama serve）`
      : message;
    return { ok: false, latencyMs, error: hint };
  }
}

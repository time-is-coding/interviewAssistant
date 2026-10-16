import type {
  DifficultyLevel,
  InterviewSession,
  LlmConfigInput,
  LlmSettingsResponse,
  Persona,
  Report,
  Resume,
  TestResult,
} from './types.ts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError('无法连接后端服务，请确认服务已启动', 0);
  }

  if (!res.ok) {
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* 响应不是 JSON，用默认文案 */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export interface TurnDoneEvent {
  message: { id: string; seq: number; role: 'interviewer'; content: string };
  roundCount: number;
  ended: boolean;
}

/**
 * 跑一轮问答，逐段消费服务端推来的 SSE。
 *
 * 不用 EventSource —— 它只支持 GET，发不了请求体。
 * 这里用 fetch 拿到 ReadableStream，手动按 SSE 的分帧规则解析。
 */
export async function streamTurn(
  sessionId: string,
  body: { content: string; inputMode: 'voice' | 'keyboard' },
  handlers: {
    onDelta: (text: string) => void;
    onDone: (event: TurnDoneEvent) => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/sessions/${sessionId}/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    handlers.onError('无法连接后端服务，请确认服务已启动');
    return;
  }

  if (!res.ok) {
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const data = (await res.json()) as { message?: string };
      message = data.message ?? message;
    } catch {
      /* 用默认文案 */
    }
    handlers.onError(message);
    return;
  }

  if (!res.body) {
    handlers.onError('服务端未返回流式响应');
    return;
  }

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
        if (!payload) continue;

        try {
          const event = JSON.parse(payload) as
            | { type: 'delta'; text: string }
            | ({ type: 'done' } & TurnDoneEvent)
            | { type: 'error'; message: string };

          if (event.type === 'delta') handlers.onDelta(event.text);
          else if (event.type === 'done') handlers.onDone(event);
          else handlers.onError(event.message);
        } catch {
          // 心跳或半截帧，忽略
        }
      }
    }
  } catch {
    handlers.onError('连接中断，本轮回复可能不完整');
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

export const api = {
  health: () => request<{ ok: boolean; dbPath: string }>('/health'),

  /* 设置 */
  getLlmSettings: () => request<LlmSettingsResponse>('/settings/llm'),
  saveLlmSettings: (input: LlmConfigInput) =>
    request<{ config: LlmSettingsResponse['config'] }>('/settings/llm', {
      ...json(input),
      method: 'PUT',
    }),
  testLlm: (input: LlmConfigInput) => request<TestResult>('/settings/llm/test', json(input)),

  /* 难度档位与面试官 */
  listDifficultyLevels: () => request<{ levels: DifficultyLevel[] }>('/difficulty-levels'),
  listPersonas: () => request<{ personas: Persona[] }>('/personas'),
  createPersona: (input: { name: string; description?: string; prompt: string }) =>
    request<{ persona: Persona }>('/personas', json(input)),
  updatePersona: (id: string, input: { name?: string; description?: string; prompt?: string }) =>
    request<{ persona: Persona }>(`/personas/${id}`, { ...json(input), method: 'PUT' }),
  deletePersona: (id: string) =>
    request<void>(`/personas/${id}`, { method: 'DELETE' }),

  /* 简历 */
  listResumes: () => request<{ resumes: Resume[] }>('/resumes'),
  getResume: (id: string) => request<{ resume: Resume }>(`/resumes/${id}`),
  uploadResume: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ resume: Resume }>('/resumes', { method: 'POST', body: form });
  },
  deleteResume: (id: string) => request<void>(`/resumes/${id}`, { method: 'DELETE' }),

  /* 会话 */
  createSession: (input: {
    resumeId: string;
    difficulty: number;
    personaId?: string;
    personaPrompt?: string;
    personaName?: string;
  }) => request<{ session: InterviewSession }>('/sessions', json(input)),
  listSessions: () => request<{ sessions: InterviewSession[] }>('/sessions'),
  getSession: (id: string) => request<{ session: InterviewSession }>(`/sessions/${id}`),
  deleteSession: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),

  /* 结束与报告 */
  finishSession: (id: string) =>
    request<{ session: InterviewSession }>(`/sessions/${id}/finish`, { method: 'POST' }),
  getReport: (sessionId: string) => request<{ report: Report }>(`/sessions/${sessionId}/report`),
  generateReport: (sessionId: string) =>
    request<{ report: Report }>(`/sessions/${sessionId}/report`, { method: 'POST' }),
};

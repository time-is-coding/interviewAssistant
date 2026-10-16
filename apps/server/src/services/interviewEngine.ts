import { randomUUID } from 'node:crypto';

import { all, get, nowIso, run } from '../db/index.js';
import { getDifficulty } from '../llm/difficulty.js';
import { buildInterviewerSystem, buildOpeningUser } from '../llm/prompts/interviewer.js';
import { chat, chatStream, type ChatMessage } from '../llm/provider.js';
import { readLlmConfig } from './llmConfig.js';
import { cleanInterviewerReply } from './replyCleanup.js';
import { detectCoveredPoints } from './textMatch.js';
import { getResumeRow, type ResumeProfile } from './resumeService.js';

/* ------------------------------ 类型 ------------------------------ */

export interface SessionRow {
  id: string;
  resume_id: string;
  difficulty: number;
  persona_id: string | null;
  persona_name: string;
  persona_prompt: string;
  status: 'created' | 'running' | 'finished';
  coverage_json: string | null;
  round_count: number;
  max_rounds: number;
  created_at: string;
  finished_at: string | null;
}

export interface MessageRow {
  id: string;
  session_id: string;
  seq: number;
  role: 'interviewer' | 'candidate';
  content: string;
  input_mode: 'voice' | 'keyboard' | null;
  meta_json: string | null;
  created_at: string;
}

export type TurnEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; message: ReturnType<typeof toMessageApi>; roundCount: number; ended: boolean }
  | { type: 'error'; message: string };

/* ------------------------------ 读取 ------------------------------ */

export function getSessionRow(id: string): SessionRow | undefined {
  return get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
}

export function listSessionRows(): SessionRow[] {
  return all<SessionRow>('SELECT * FROM sessions ORDER BY created_at DESC');
}

export function getMessageRows(sessionId: string): MessageRow[] {
  return all<MessageRow>('SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC', sessionId);
}

export function deleteSession(id: string): void {
  run('DELETE FROM sessions WHERE id = ?', id);
}

function parseCoverage(row: SessionRow): string[] {
  if (!row.coverage_json) return [];
  try {
    const parsed: unknown = JSON.parse(row.coverage_json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parseProfile(session: SessionRow): ResumeProfile | null {
  const resume = getResumeRow(session.resume_id);
  if (!resume?.profile_json) return null;
  try {
    return JSON.parse(resume.profile_json) as ResumeProfile;
  } catch {
    return null;
  }
}

export function toMessageApi(row: MessageRow) {
  return {
    id: row.id,
    seq: row.seq,
    role: row.role,
    content: row.content,
    inputMode: row.input_mode,
    createdAt: row.created_at,
  };
}

export function toSessionApi(row: SessionRow, withMessages = false) {
  return {
    id: row.id,
    resumeId: row.resume_id,
    difficulty: row.difficulty,
    personaId: row.persona_id,
    personaName: row.persona_name,
    status: row.status,
    roundCount: row.round_count,
    maxRounds: row.max_rounds,
    coverage: parseCoverage(row),
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    ...(withMessages ? { messages: getMessageRows(row.id).map(toMessageApi) } : {}),
  };
}

/* ------------------------------ 写入 ------------------------------ */

function nextSeq(sessionId: string): number {
  const row = get<{ maxSeq: number | null }>(
    'SELECT MAX(seq) AS maxSeq FROM messages WHERE session_id = ?',
    sessionId,
  );
  return (row?.maxSeq ?? 0) + 1;
}

function appendMessage(
  sessionId: string,
  role: 'interviewer' | 'candidate',
  content: string,
  inputMode: 'voice' | 'keyboard' | null = null,
  meta: Record<string, unknown> | null = null,
): MessageRow {
  const row: MessageRow = {
    id: randomUUID(),
    session_id: sessionId,
    seq: nextSeq(sessionId),
    role,
    content,
    input_mode: inputMode,
    meta_json: meta ? JSON.stringify(meta) : null,
    created_at: nowIso(),
  };

  run(
    `INSERT INTO messages (id, session_id, seq, role, content, input_mode, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.session_id,
    row.seq,
    row.role,
    row.content,
    row.input_mode,
    row.meta_json,
    row.created_at,
  );

  return row;
}

/* --------------------------- 会话生命周期 --------------------------- */

export class SessionError extends Error {}

export async function createSession(input: {
  resumeId: string;
  difficulty: number;
  personaId?: string;
  personaPrompt?: string;
  personaName?: string;
}): Promise<SessionRow> {
  const resume = getResumeRow(input.resumeId);
  if (!resume) throw new SessionError('简历不存在');
  if (resume.parse_status !== 'done' || !resume.profile_json) {
    throw new SessionError('简历尚未解析完成，请稍后再试');
  }

  const difficulty = getDifficulty(input.difficulty);

  // 面试官提示词快照：优先用传入的自定义提示词，否则取预设
  let personaName = input.personaName?.trim() ?? '';
  let personaPrompt = input.personaPrompt?.trim() ?? '';

  if (!personaPrompt && input.personaId) {
    const persona = get<{ name: string; prompt: string }>(
      'SELECT name, prompt FROM personas WHERE id = ?',
      input.personaId,
    );
    if (!persona) throw new SessionError('所选面试官不存在');
    personaName = persona.name;
    personaPrompt = persona.prompt;
  }

  if (!personaPrompt) throw new SessionError('缺少面试官提示词');
  if (!personaName) personaName = '自定义面试官';

  const id = randomUUID();
  const now = nowIso();
  run(
    `INSERT INTO sessions
       (id, resume_id, difficulty, persona_id, persona_name, persona_prompt, status,
        coverage_json, round_count, max_rounds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'created', ?, 0, ?, ?)`,
    id,
    input.resumeId,
    difficulty.level,
    input.personaId ?? null,
    personaName,
    personaPrompt,
    JSON.stringify([]),
    difficulty.maxRounds,
    now,
  );

  const row = getSessionRow(id);
  if (!row) throw new SessionError('会话创建失败');

  await generateOpening(row);
  return getSessionRow(id) ?? row;
}

/** 组装发给模型的消息列表。历史里已剥离标记，可以直接作为上下文。 */
function buildContext(session: SessionRow, profile: ResumeProfile): ChatMessage[] {
  const system = buildInterviewerSystem({
    personaName: session.persona_name,
    personaPrompt: session.persona_prompt,
    difficulty: getDifficulty(session.difficulty),
    profile,
    covered: parseCoverage(session),
    roundCount: session.round_count,
  });

  const history = getMessageRows(session.id).map<ChatMessage>((m) => ({
    role: m.role === 'interviewer' ? 'assistant' : 'user',
    content: m.content,
  }));

  return [{ role: 'system', content: system }, ...history];
}

/** 生成开场白与第一个问题。本地模型可能要十几秒，调用方需给出加载态。 */
async function generateOpening(session: SessionRow): Promise<void> {
  const profile = parseProfile(session);
  if (!profile) throw new SessionError('简历画像缺失');

  const cfg = readLlmConfig();
  const messages: ChatMessage[] = [
    ...buildContext(session, profile),
    { role: 'user', content: buildOpeningUser() },
  ];

  const raw = await chat(cfg, messages);
  const content = cleanInterviewerReply(raw);
  appendMessage(session.id, 'interviewer', content, null, { raw });

  // 开场问题往往就点名了第一个项目，同样参与覆盖度判定
  const covered = detectCoveredPoints([content], profile.assessmentPoints);
  run(
    `UPDATE sessions SET status = 'running', coverage_json = ? WHERE id = ?`,
    JSON.stringify(covered),
    session.id,
  );
}

/**
 * 跑一轮问答：落库候选人回答，流式产出面试官回复，最后更新覆盖度与轮次。
 * 结束条件（手动结束不在这里，由 finish 接口处理）：
 * 模型输出 END 标记，或轮次达到该难度上限。
 */
export async function* runTurn(
  sessionId: string,
  candidateContent: string,
  inputMode: 'voice' | 'keyboard',
): AsyncGenerator<TurnEvent, void, undefined> {
  const session = getSessionRow(sessionId);
  if (!session) {
    yield { type: 'error', message: '会话不存在' };
    return;
  }
  if (session.status === 'finished') {
    yield { type: 'error', message: '本场面试已结束' };
    return;
  }

  const profile = parseProfile(session);
  if (!profile) {
    yield { type: 'error', message: '简历画像缺失，无法继续面试' };
    return;
  }

  appendMessage(sessionId, 'candidate', candidateContent, inputMode);

  const cfg = readLlmConfig();
  const messages = buildContext(session, profile);

  let raw = '';
  try {
    for await (const delta of chatStream(cfg, messages)) {
      raw += delta;
      yield { type: 'delta', text: delta };
    }
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
    return;
  }

  // 模型可能一个字都没吐出来（例如被上游截断）
  if (!raw.trim()) {
    yield { type: 'error', message: '模型未返回内容，请重试' };
    return;
  }

  const content = cleanInterviewerReply(raw);
  const message = appendMessage(sessionId, 'interviewer', content, null, { raw });

  // 覆盖度由应用层根据问题文本判定，不依赖模型输出标记
  const newlyCovered = detectCoveredPoints([content], profile.assessmentPoints);
  const merged = [...new Set([...parseCoverage(session), ...newlyCovered])];
  const roundCount = session.round_count + 1;
  const shouldEnd = roundCount >= session.max_rounds;

  run(
    `UPDATE sessions SET coverage_json = ?, round_count = ?, status = 'running' WHERE id = ?`,
    JSON.stringify(merged),
    roundCount,
    sessionId,
  );

  if (shouldEnd) {
    run(
      `UPDATE sessions SET status = 'finished', finished_at = ? WHERE id = ?`,
      nowIso(),
      sessionId,
    );
  }

  yield { type: 'done', message: toMessageApi(message), roundCount, ended: shouldEnd };
}

/** 候选人主动结束面试。 */
export function finishSession(sessionId: string): SessionRow | undefined {
  const session = getSessionRow(sessionId);
  if (!session) return undefined;
  if (session.status === 'finished') return session;

  run(
    `UPDATE sessions SET status = 'finished', finished_at = ? WHERE id = ?`,
    nowIso(),
    sessionId,
  );
  return getSessionRow(sessionId);
}

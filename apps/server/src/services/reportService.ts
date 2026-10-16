import { randomUUID } from 'node:crypto';

import { get, nowIso, run } from '../db/index.js';
import { getDifficulty } from '../llm/difficulty.js';
import { parseJsonLoose } from '../llm/json.js';
import {
  buildReportSystem,
  buildReportUser,
  getDimensionsForDifficulty,
  type DimensionDef,
} from '../llm/prompts/report.js';
import { chat } from '../llm/provider.js';
import { getMessageRows, getSessionRow, type SessionRow } from './interviewEngine.js';
import { readLlmConfig } from './llmConfig.js';
import { getResumeRow, type ResumeProfile } from './resumeService.js';
import { filterDuplicatesAgainst, maxSimilarity } from './textMatch.js';

/* ------------------------------ 类型 ------------------------------ */

export interface ReportEvidence {
  quote: string;
  comment: string;
}

export interface ReportDimension {
  key: string;
  name: string;
  score: number;
  weight: number;
  summary: string;
  evidence: ReportEvidence[];
  advice: string;
}

export interface ReportPoint {
  point: string;
  evidence: string;
}

export interface ReportPayload {
  summary: string;
  dimensions: ReportDimension[];
  strengths: ReportPoint[];
  weaknesses: ReportPoint[];
  resumeConcerns: string[];
  suggestedAnswerOutline: Array<{ question: string; betterAnswer: string }>;
  nextSteps: string[];
  /** 评估所依据的职级标准 */
  evaluatedAtLevel: string;
}

interface ReportRow {
  id: string;
  session_id: string;
  overall: number;
  recommendation: string;
  score_json: string;
  markdown: string;
  created_at: string;
}

/** 模型的原始输出，字段可能缺失或类型不对，交给 normalize 兜底。 */
interface RawReport {
  overallScore?: unknown;
  recommendation?: unknown;
  summary?: unknown;
  dimensions?: unknown;
  strengths?: unknown;
  weaknesses?: unknown;
  resumeConcerns?: unknown;
  suggestedAnswerOutline?: unknown;
  nextSteps?: unknown;
}

export class ReportError extends Error {}

/* ------------------------------ 生成 ------------------------------ */

export async function generateReport(sessionId: string): Promise<ReportRow> {
  const existing = getReportRow(sessionId);
  if (existing) return existing;

  const session = getSessionRow(sessionId);
  if (!session) throw new ReportError('会话不存在');

  const resume = getResumeRow(session.resume_id);
  if (!resume?.profile_json) throw new ReportError('简历画像缺失，无法生成报告');

  const messages = getMessageRows(sessionId);
  const candidateTurns = messages.filter((m) => m.role === 'candidate').length;
  if (candidateTurns === 0) throw new ReportError('本场面试没有任何回答，无法评分');

  const profile = JSON.parse(resume.profile_json) as ResumeProfile;
  const difficulty = getDifficulty(session.difficulty);
  const dimensions = getDimensionsForDifficulty(difficulty.level);

  const cfg = readLlmConfig();
  const raw = await chat(
    cfg,
    [
      { role: 'system', content: buildReportSystem(difficulty, dimensions) },
      {
        role: 'user',
        content: buildReportUser({
          profile,
          personaName: session.persona_name,
          difficulty,
          messages,
        }),
      },
    ],
    { temperature: 0.2 },
  );

  let parsed: RawReport;
  try {
    parsed = parseJsonLoose<RawReport>(raw);
  } catch {
    // 再给模型一次机会，明确要求只输出 JSON
    const retry = await chat(
      cfg,
      [
        { role: 'system', content: buildReportSystem(difficulty, dimensions) },
        {
          role: 'user',
          content: buildReportUser({
            profile,
            personaName: session.persona_name,
            difficulty,
            messages,
          }),
        },
        { role: 'assistant', content: raw.slice(0, 2000) },
        { role: 'user', content: '上面的内容不是合法 JSON。请只输出那个 JSON 对象本身，不要任何其他文字。' },
      ],
      { temperature: 0 },
    );
    parsed = parseJsonLoose<RawReport>(retry);
  }

  const payload = normalizePayload(
    parsed,
    dimensions,
    difficulty,
    messages.filter((m) => m.role === 'candidate').map((m) => m.content),
  );
  const overall = weightedOverall(payload.dimensions);
  const recommendation = deriveRecommendation(overall);
  const markdown = renderMarkdown(payload, overall, recommendation, session);

  const id = randomUUID();
  const now = nowIso();
  run(
    `INSERT INTO reports (id, session_id, overall, recommendation, score_json, markdown, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    sessionId,
    overall,
    recommendation,
    JSON.stringify(payload),
    markdown,
    now,
  );

  const row = getReportRow(sessionId);
  if (!row) throw new ReportError('报告保存失败');
  return row;
}

export function getReportRow(sessionId: string): ReportRow | undefined {
  return get<ReportRow>('SELECT * FROM reports WHERE session_id = ?', sessionId);
}

/* ------------------------------ 规整 ------------------------------ */

function toScore(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function toTextArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(toText).filter(Boolean) : [];
}

function normalizeEvidence(v: unknown): ReportEvidence[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ quote: toText(x.quote), comment: toText(x.comment) }))
    .filter((e) => e.quote || e.comment);
}

function normalizePoints(v: unknown): ReportPoint[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((x) => ({ point: toText(x.point), evidence: toText(x.evidence) }))
    .filter((p) => p.point);
}

/**
 * 一条「优点」与候选人回答的最低相似度。
 *
 * 阈值取得低，只拦「跟面试毫无关系」的条目（例如直接照抄简历的「有多年开发经验」）。
 * 宁可漏判也不要误杀：一条真优点被丢掉，损失小于一条空夸留在报告里。
 */
const GROUNDED_THRESHOLD = 0.2;

function normalizePayload(
  raw: RawReport,
  dimensions: DimensionDef[],
  difficulty: ReturnType<typeof getDifficulty>,
  candidateAnswers: string[],
): ReportPayload {
  const rawDims = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  const byKey = new Map<string, Record<string, unknown>>();
  for (const d of rawDims) {
    if (typeof d === 'object' && d !== null) {
      const obj = d as Record<string, unknown>;
      const key = toText(obj.key);
      if (key) byKey.set(key, obj);
    }
  }

  // 以定义为准逐个映射：模型漏掉的维度补 0 分并注明未考察，
  // 模型多输出的维度直接丢弃，保证报告结构稳定。
  const normalized: ReportDimension[] = dimensions.map((def) => {
    const found = byKey.get(def.key);
    if (!found) {
      return {
        key: def.key,
        name: def.name,
        score: 0,
        weight: def.weight,
        summary: '本场面试未考察到该维度',
        evidence: [],
        advice: '本场面试未能收集到该维度的证据，建议重新面试以覆盖此维度。',
      };
    }
    return {
      key: def.key,
      name: def.name,
      score: toScore(found.score),
      weight: def.weight,
      summary: toText(found.summary),
      evidence: normalizeEvidence(found.evidence),
      advice: toText(found.advice),
    };
  });

  const outline = Array.isArray(raw.suggestedAnswerOutline)
    ? raw.suggestedAnswerOutline
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({ question: toText(x.question), betterAnswer: toText(x.betterAnswer) }))
        .filter((x) => x.question)
    : [];

  // strengths 必须有面试中的证据支撑。模型爱把简历上写了什么当成优点来夸
  // （「项目经历丰富」「有多年开发经验」），而那根本不是本场面试表现出来的。
  // 两道过滤：先要求填了证据，再要求证据确实能在候选人的回答里找到依据。
  const strengths = normalizePoints(raw.strengths)
    .filter((s) => s.evidence)
    .filter((s) => maxSimilarity(`${s.point}${s.evidence}`, candidateAnswers) >= GROUNDED_THRESHOLD);

  const weaknesses = normalizePoints(raw.weaknesses);

  // resumeConcerns 只该写简历本身的问题，模型经常把 weaknesses 原样抄一遍。
  // 拿 weaknesses 做一次去重，保证这两个字段各说各的。
  const weaknessTexts = weaknesses.map((w) => `${w.point}${w.evidence}`);
  const resumeConcerns = filterDuplicatesAgainst(toTextArray(raw.resumeConcerns), weaknessTexts);

  return {
    summary: toText(raw.summary) || '模型未给出整体判断。',
    dimensions: normalized,
    strengths,
    weaknesses,
    resumeConcerns,
    suggestedAnswerOutline: outline,
    nextSteps: toTextArray(raw.nextSteps),
    evaluatedAtLevel: `L${difficulty.level} ${difficulty.label}`,
  };
}

/** 总分取各维度加权平均，保证与页面上展示的维度分一致。 */
function weightedOverall(dimensions: ReportDimension[]): number {
  const total = dimensions.reduce((sum, d) => sum + d.score * d.weight, 0);
  return Math.round(total);
}

/**
 * 结论由总分推导，不再单独采信模型给的 recommendation ——
 * 避免出现「总分 45 分但结论推荐」这种自相矛盾的报告。
 */
function deriveRecommendation(overall: number): string {
  if (overall >= 80) return '推荐';
  if (overall >= 55) return '待定';
  return '不推荐';
}

/* ------------------------------ Markdown ------------------------------ */

function renderMarkdown(
  payload: ReportPayload,
  overall: number,
  recommendation: string,
  session: SessionRow,
): string {
  const lines: string[] = [];

  lines.push(`# 面试评估报告`);
  lines.push('');
  lines.push(`- 面试官：${session.persona_name}`);
  lines.push(`- 评估标准：${payload.evaluatedAtLevel}`);
  lines.push(`- 面试轮次：${session.round_count} 轮`);
  lines.push(`- 日期：${new Date(session.created_at).toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push(`## 总分 ${overall} / 100 ｜ 结论：${recommendation}`);
  lines.push('');
  lines.push(payload.summary);
  lines.push('');

  lines.push('## 维度得分');
  lines.push('');
  lines.push('| 维度 | 权重 | 得分 |');
  lines.push('| --- | --- | --- |');
  for (const d of payload.dimensions) {
    lines.push(`| ${d.name} | ${(d.weight * 100).toFixed(0)}% | ${d.score} |`);
  }
  lines.push('');

  for (const d of payload.dimensions) {
    lines.push(`### ${d.name} —— ${d.score} 分`);
    lines.push('');
    if (d.summary) lines.push(d.summary);
    lines.push('');
    if (d.evidence.length) {
      lines.push('证据：');
      for (const e of d.evidence) {
        lines.push(`- 「${e.quote}」${e.comment ? ` —— ${e.comment}` : ''}`);
      }
      lines.push('');
    }
    if (d.advice) {
      lines.push(`改进建议：${d.advice}`);
      lines.push('');
    }
  }

  if (payload.strengths.length) {
    lines.push('## 做得好的地方');
    lines.push('');
    for (const s of payload.strengths) {
      lines.push(`- **${s.point}**${s.evidence ? `：${s.evidence}` : ''}`);
    }
    lines.push('');
  }

  if (payload.weaknesses.length) {
    lines.push('## 明确的问题');
    lines.push('');
    for (const w of payload.weaknesses) {
      lines.push(`- **${w.point}**${w.evidence ? `：${w.evidence}` : ''}`);
    }
    lines.push('');
  }

  if (payload.resumeConcerns.length) {
    lines.push('## 简历本身的问题');
    lines.push('');
    for (const c of payload.resumeConcerns) lines.push(`- ${c}`);
    lines.push('');
  }

  if (payload.suggestedAnswerOutline.length) {
    lines.push('## 答得不好的题目，更好的答法');
    lines.push('');
    for (const o of payload.suggestedAnswerOutline) {
      lines.push(`**问：${o.question}**`);
      lines.push('');
      lines.push(`答：${o.betterAnswer}`);
      lines.push('');
    }
  }

  if (payload.nextSteps.length) {
    lines.push('## 下一步');
    lines.push('');
    payload.nextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
  }

  return lines.join('\n');
}

/* ------------------------------ 输出 ------------------------------ */

export function toReportApi(row: ReportRow) {
  let payload: ReportPayload | null = null;
  try {
    payload = JSON.parse(row.score_json) as ReportPayload;
  } catch {
    payload = null;
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    overall: row.overall,
    recommendation: row.recommendation,
    summary: payload?.summary ?? '',
    dimensions: payload?.dimensions ?? [],
    strengths: payload?.strengths ?? [],
    weaknesses: payload?.weaknesses ?? [],
    resumeConcerns: payload?.resumeConcerns ?? [],
    suggestedAnswerOutline: payload?.suggestedAnswerOutline ?? [],
    nextSteps: payload?.nextSteps ?? [],
    evaluatedAtLevel: payload?.evaluatedAtLevel ?? '',
    markdown: row.markdown,
    createdAt: row.created_at,
  };
}

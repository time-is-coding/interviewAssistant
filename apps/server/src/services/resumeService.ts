import { randomUUID } from 'node:crypto';

import { all, get, nowIso, run } from '../db/index.js';
import { parseJsonLoose } from '../llm/json.js';
import { RESUME_PARSE_SYSTEM, buildResumeParseUser } from '../llm/prompts/resume.js';
import { chat } from '../llm/provider.js';
import { dedupePoints } from './textMatch.js';
import { readLlmConfig } from './llmConfig.js';
import { truncateForModel } from './resumeParser.js';

/* ------------------------------ 类型 ------------------------------ */

export interface WorkExperience {
  company: string;
  role: string;
  period: string;
  summary: string;
}

export interface ProjectExperience {
  name: string;
  period: string;
  techStack: string[];
  description: string;
}

export interface Education {
  school: string;
  major: string;
  degree: string;
  period: string;
}

export interface ResumeProfile {
  targetRole: string;
  yearsOfExperience: string;
  techStack: string[];
  workExperience: WorkExperience[];
  projects: ProjectExperience[];
  selfEvaluation: string;
  education: Education[];
  other: string[];
  /** 可考察要点，作为面试覆盖度追踪的初始未覆盖集合。 */
  assessmentPoints: string[];
}

interface ResumeRow {
  id: string;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  raw_text: string;
  profile_json: string | null;
  parse_status: 'pending' | 'parsing' | 'done' | 'failed';
  parse_error: string | null;
  created_at: string;
}

/* --------------------------- 读写 --------------------------- */

export function insertResume(input: {
  filename: string;
  mime: string | null;
  sizeBytes: number;
  rawText: string;
}): string {
  const id = randomUUID();
  run(
    `INSERT INTO resumes (id, filename, mime, size_bytes, raw_text, parse_status, created_at)
     VALUES (?, ?, ?, ?, ?, 'parsing', ?)`,
    id,
    input.filename,
    input.mime,
    input.sizeBytes,
    input.rawText,
    nowIso(),
  );
  return id;
}

export function getResumeRow(id: string): ResumeRow | undefined {
  return get<ResumeRow>('SELECT * FROM resumes WHERE id = ?', id);
}

export function listResumeRows(): ResumeRow[] {
  return all<ResumeRow>('SELECT * FROM resumes ORDER BY created_at DESC');
}

export function deleteResume(id: string): void {
  run('DELETE FROM resumes WHERE id = ?', id);
}

/** 数据库行 → 接口返回形态。列表场景不回传原文与原文长度以外的重字段。 */
export function toResumeApi(row: ResumeRow) {
  let profile: ResumeProfile | null = null;
  if (row.profile_json) {
    try {
      profile = JSON.parse(row.profile_json) as ResumeProfile;
    } catch {
      profile = null;
    }
  }

  return {
    id: row.id,
    filename: row.filename,
    sizeBytes: row.size_bytes,
    parseStatus: row.parse_status,
    parseError: row.parse_error,
    profile,
    createdAt: row.created_at,
    rawTextLength: row.raw_text.length,
  };
}

/* ------------------------- 大模型解析 ------------------------- */

/**
 * 调用大模型把简历原文转成结构化画像。
 * 由上传接口在后台触发，前端轮询解析状态。
 */
export async function parseResumeInBackground(resumeId: string): Promise<void> {
  const row = getResumeRow(resumeId);
  if (!row) return;

  try {
    const cfg = readLlmConfig();
    const content = await chat(
      cfg,
      [
        { role: 'system', content: RESUME_PARSE_SYSTEM },
        { role: 'user', content: buildResumeParseUser(truncateForModel(row.raw_text)) },
      ],
      { temperature: 0.1 },
    );

    const profile = normalizeProfile(parseJsonLoose<Partial<ResumeProfile>>(content));

    run(
      `UPDATE resumes SET profile_json = ?, parse_status = 'done', parse_error = NULL WHERE id = ?`,
      JSON.stringify(profile),
      resumeId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    run(`UPDATE resumes SET parse_status = 'failed', parse_error = ? WHERE id = ?`, message, resumeId);
  }
}

/** 把模型可能漏填/填错类型的字段补齐成稳定结构，后续代码就不用到处判空。 */
function normalizeProfile(raw: Partial<ResumeProfile>): ResumeProfile {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const objArray = <T>(v: unknown, map: (o: Record<string, unknown>) => T): T[] =>
    Array.isArray(v)
      ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null).map(map)
      : [];

  return {
    targetRole: str(raw.targetRole),
    yearsOfExperience: str(raw.yearsOfExperience),
    techStack: strArray(raw.techStack),
    workExperience: objArray(raw.workExperience, (o) => ({
      company: str(o.company),
      role: str(o.role),
      period: str(o.period),
      summary: str(o.summary),
    })),
    projects: objArray(raw.projects, (o) => ({
      name: str(o.name),
      period: str(o.period),
      techStack: strArray(o.techStack),
      description: str(o.description),
    })),
    selfEvaluation: str(raw.selfEvaluation),
    education: objArray(raw.education, (o) => ({
      school: str(o.school),
      major: str(o.major),
      degree: str(o.degree),
      period: str(o.period),
    })),
    other: strArray(raw.other),
    assessmentPoints: dedupePoints(strArray(raw.assessmentPoints)),
  };
}

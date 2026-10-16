/** 与后端接口一一对应的类型定义。 */

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
  note?: string;
}

export interface PublicLlmConfig {
  presetId: string;
  baseUrl: string;
  model: string;
  temperature: number;
  /** 掩码后的 Key，如 sk-****1234。明文永不下发。 */
  apiKeyMasked: string;
  hasApiKey: boolean;
}

export interface LlmSettingsResponse {
  presets: ProviderPreset[];
  config: PublicLlmConfig;
}

/** 提交给后端的配置。apiKey 省略表示保持原 Key 不变。 */
export interface LlmConfigInput {
  presetId?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  apiKey?: string;
}

export interface TestResult {
  ok: boolean;
  latencyMs: number;
  models?: string[];
  error?: string;
}

/* ------------------------------- 难度 ------------------------------- */

export interface DifficultyLevel {
  level: number;
  label: string;
  positioning: string;
  maxRounds: number;
}

/* ------------------------------- 面试官 ------------------------------- */

export interface Persona {
  id: string;
  name: string;
  description: string;
  prompt: string;
  builtin: boolean;
}

/* -------------------------------- 简历 -------------------------------- */

export interface ResumeProfile {
  targetRole: string;
  yearsOfExperience: string;
  techStack: string[];
  workExperience: Array<{ company: string; role: string; period: string; summary: string }>;
  projects: Array<{ name: string; period: string; techStack: string[]; description: string }>;
  selfEvaluation: string;
  education: Array<{ school: string; major: string; degree: string; period: string }>;
  other: string[];
  /** 可考察要点，面试时用于追踪覆盖度 */
  assessmentPoints: string[];
}

export interface Resume {
  id: string;
  filename: string;
  sizeBytes: number | null;
  parseStatus: 'pending' | 'parsing' | 'done' | 'failed';
  parseError: string | null;
  profile: ResumeProfile | null;
  createdAt: string;
  rawTextLength: number;
}

/* ------------------------------- 会话 -------------------------------- */

export interface InterviewMessage {
  id: string;
  seq: number;
  role: 'interviewer' | 'candidate';
  content: string;
  inputMode: 'voice' | 'keyboard' | null;
  createdAt: string;
}

export interface InterviewSession {
  id: string;
  resumeId: string;
  difficulty: number;
  personaId: string | null;
  personaName: string;
  status: 'created' | 'running' | 'finished';
  roundCount: number;
  maxRounds: number;
  coverage: string[];
  createdAt: string;
  finishedAt: string | null;
  messages: InterviewMessage[];
}

/* ------------------------------- 报告 -------------------------------- */

export interface ReportEvidence {
  quote: string;
  comment: string;
}

export interface ReportDimension {
  key: string;
  name: string;
  score: number;
  weight: number;
  summary?: string;
  evidence: ReportEvidence[];
  advice: string;
}

export interface ReportPoint {
  point: string;
  evidence: string;
}

export interface Report {
  id: string;
  sessionId: string;
  overall: number;
  recommendation: string;
  dimensions: ReportDimension[];
  summary: string;
  strengths: ReportPoint[];
  weaknesses: ReportPoint[];
  resumeConcerns: string[];
  suggestedAnswerOutline: Array<{ question: string; betterAnswer: string }>;
  nextSteps: string[];
  evaluatedAtLevel: string;
  markdown: string;
  createdAt: string;
}

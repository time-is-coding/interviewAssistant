/**
 * 数据库表结构。
 *
 * 以 TS 常量而非 .sql 文件的形式存放，是为了让 `tsc` 构建产物自带 schema，
 * 不需要额外的「拷贝非 TS 资源到 dist」步骤。
 *
 * 关于字段注释：SQLite 不支持 MySQL/PostgreSQL 那样的 COMMENT ON 语法，
 * 也无法在 CREATE TABLE 里写列注释，因此注释统一以 `--` 行注释的形式
 * 紧跟在每个字段定义之后 + 之前，作为唯一可读的文档来源。
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

/* ------------------------------------------------------------------ */
/* app_config —— 应用配置（键值对），目前用于存放 LLM 供应商配置        */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,  -- 配置项名称。当前使用 'llm.config'
  value      TEXT NOT NULL,     -- 配置内容，统一以 JSON 字符串存放
  updated_at TEXT NOT NULL      -- 最后更新时间，ISO 8601 字符串（如 2026-10-15T14:59:03.000Z）
);

/* ------------------------------------------------------------------ */
/* personas —— 面试官。内置的 builtin = 1，不可删除或修改               */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS personas (
  id          TEXT PRIMARY KEY,           -- 面试官唯一标识。内置的用固定语义 id：bytedance / alibaba / baidu / pinduoduo / huawei
  name        TEXT NOT NULL,              -- 面试官名称，展示在配置页卡片上
  description TEXT NOT NULL DEFAULT '',   -- 一句话风格说明，帮助用户判断该选哪个
  prompt      TEXT NOT NULL,              -- 面试官人设与提问风格提示词，会拼进面试系统提示词
  builtin     INTEGER NOT NULL DEFAULT 0, -- 是否内置：1 = 内置（不可改删），0 = 用户自建
  sort_order  INTEGER NOT NULL DEFAULT 0, -- 排序权重，升序排列。内置的按 10/20/30... 递增，自建的排在后面
  created_at  TEXT NOT NULL               -- 创建时间，ISO 8601 字符串
);

/* ------------------------------------------------------------------ */
/* resumes —— 简历                                                    */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS resumes (
  id           TEXT PRIMARY KEY,                  -- 简历唯一标识（uuid）
  filename     TEXT NOT NULL,                     -- 上传时的原始文件名，仅用于展示
  mime         TEXT,                              -- 文件 MIME 类型，如 application/pdf
  size_bytes   INTEGER,                           -- 文件字节数，用于展示与限额校验
  raw_text     TEXT NOT NULL DEFAULT '',          -- 从 PDF 中抽取出的完整纯文本，作为解析与提问的原始依据
  profile_json TEXT,                              -- 大模型解析出的结构化画像（目标岗位/项目经验/工作经验/技术栈/工作年限/自评等）的 JSON
  parse_status TEXT NOT NULL DEFAULT 'pending',   -- 解析状态：pending 待解析 | parsing 解析中 | done 已完成 | failed 失败
  parse_error  TEXT,                              -- 解析失败时的错误信息，供前端提示用户
  created_at   TEXT NOT NULL                      -- 创建时间，ISO 8601 字符串
);

/* ------------------------------------------------------------------ */
/* sessions —— 面试会话                                               */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,               -- 会话唯一标识（uuid）
  resume_id      TEXT NOT NULL,                  -- 关联的简历 id，指向 resumes.id；简历删除时级联删除
  difficulty     INTEGER NOT NULL,               -- 面试难度档位，取值 1..5，对应实习生 / 初级 / 中级 / 高级 / 行业专家
  persona_id     TEXT,                           -- 使用的面试官 id，仅作溯源；面试官可能被删除，故不加外键
  persona_name   TEXT NOT NULL,                  -- 面试官名称快照，保证历史面试记录不受预设变更影响
  persona_prompt TEXT NOT NULL,                  -- 面试官提示词快照，同上
  status         TEXT NOT NULL DEFAULT 'created',-- 会话状态：created 已创建 | running 进行中 | finished 已结束
  coverage_json  TEXT,                           -- 已考察要点的 JSON 数组，由面试官每轮输出的覆盖标记累积而成
  round_count    INTEGER NOT NULL DEFAULT 0,     -- 已完成的问答轮次（候选人回答的次数）
  max_rounds     INTEGER NOT NULL,               -- 本次面试的轮次上限，按难度档位决定，达到后自动进入评分
  created_at     TEXT NOT NULL,                  -- 创建时间，ISO 8601 字符串
  finished_at    TEXT,                           -- 面试结束时间，未结束时为空
  FOREIGN KEY (resume_id) REFERENCES resumes(id) ON DELETE CASCADE
);

/* ------------------------------------------------------------------ */
/* messages —— 面试对话记录                                           */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,               -- 消息唯一标识（uuid）
  session_id TEXT NOT NULL,                  -- 所属会话 id，指向 sessions.id；会话删除时级联删除
  seq        INTEGER NOT NULL,               -- 会话内序号，从 1 开始递增，用于稳定排序与上下文组装
  role       TEXT NOT NULL,                  -- 发言方：interviewer 面试官 | candidate 候选人
  content    TEXT NOT NULL,                  -- 消息正文。面试官消息已剥离对候选人不可见的覆盖标记
  input_mode TEXT,                           -- 候选人作答方式：voice 语音输入 | keyboard 键盘输入；面试官消息为空
  meta_json  TEXT,                           -- 附加信息 JSON，如模型名、耗时、token 用量等，便于排查问题
  created_at TEXT NOT NULL,                  -- 创建时间，ISO 8601 字符串
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
-- 按会话 + 序号建索引，覆盖「取某场面试全部对话」这一最主要的查询
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);

/* ------------------------------------------------------------------ */
/* reports —— 评分报告                                                */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS reports (
  id             TEXT PRIMARY KEY,           -- 报告唯一标识（uuid）
  session_id     TEXT NOT NULL UNIQUE,       -- 所属会话 id，指向 sessions.id；一场面试只出一份报告
  overall        REAL NOT NULL,              -- 总分，百分制 0-100
  recommendation TEXT NOT NULL,              -- 结论：推荐 | 待定 | 不推荐
  score_json     TEXT NOT NULL,              -- 完整评分 JSON：各维度得分/权重/证据引用/改进建议、优点、不足、简历问题等
  markdown       TEXT NOT NULL,              -- 报告全文的 Markdown 版本，供页面直接渲染与留存
  created_at     TEXT NOT NULL,              -- 创建时间，ISO 8601 字符串
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`;

import type { FastifyPluginAsync } from 'fastify';

import { DIFFICULTY_LEVELS } from '../llm/difficulty.js';
import {
  SessionError,
  createSession,
  deleteSession,
  finishSession,
  getSessionRow,
  listSessionRows,
  runTurn,
  toSessionApi,
} from '../services/interviewEngine.js';
import { ReportError, generateReport, getReportRow, toReportApi } from '../services/reportService.js';

interface CreateSessionBody {
  resumeId?: string;
  difficulty?: number;
  personaId?: string;
  personaPrompt?: string;
  personaName?: string;
}

interface TurnBody {
  content?: string;
  inputMode?: string;
}

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  /** 难度档位定义。前端不硬编码，保证与面试引擎用的是同一份数据。 */
  app.get('/difficulty-levels', async () => ({
    levels: DIFFICULTY_LEVELS.map(({ level, label, positioning, maxRounds }) => ({
      level,
      label,
      positioning,
      maxRounds,
    })),
  }));

  /* ------------------------------ 创建 ------------------------------ */

  app.post<{ Body: CreateSessionBody }>('/sessions', async (req, reply) => {
    const { resumeId, difficulty } = req.body ?? {};
    if (!resumeId) return reply.code(400).send({ message: '缺少简历 id' });
    if (typeof difficulty !== 'number') return reply.code(400).send({ message: '缺少面试难度' });

    try {
      const session = await createSession({
        resumeId,
        difficulty,
        personaId: req.body?.personaId,
        personaPrompt: req.body?.personaPrompt,
        personaName: req.body?.personaName,
      });
      return reply.code(201).send({ session: toSessionApi(session, true) });
    } catch (err) {
      if (err instanceof SessionError) return reply.code(400).send({ message: err.message });
      const message = err instanceof Error ? err.message : String(err);
      // 开场白生成失败（模型没连上等）时会走到这里
      return reply.code(502).send({ message: `面试开场生成失败：${message}` });
    }
  });

  /* ------------------------------ 查询 ------------------------------ */

  app.get('/sessions', async () => ({
    sessions: listSessionRows().map((row) => toSessionApi(row)),
  }));

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const row = getSessionRow(req.params.id);
    if (!row) return reply.code(404).send({ message: '会话不存在' });
    return { session: toSessionApi(row, true) };
  });

  app.delete<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const row = getSessionRow(req.params.id);
    if (!row) return reply.code(404).send({ message: '会话不存在' });
    deleteSession(req.params.id);
    return reply.code(204).send();
  });

  /* ------------------------------ 一轮问答 ------------------------------ */

  app.post<{ Params: { id: string }; Body: TurnBody }>('/sessions/:id/turn', async (req, reply) => {
    const content = req.body?.content?.trim();
    const inputMode = req.body?.inputMode === 'voice' ? 'voice' : 'keyboard';

    if (!content) return reply.code(400).send({ message: '回答内容为空' });

    // 交给原始 response 自己写，Fastify 不再插手
    reply.hijack();

    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const write = (event: unknown): void => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of runTurn(req.params.id, content, inputMode)) {
        write(event);
        if (event.type !== 'delta') break; // done / error 之后收工
      }
    } catch (err) {
      write({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      res.end();
    }
  });

  /* ------------------------------ 结束与报告 ------------------------------ */

  app.post<{ Params: { id: string } }>('/sessions/:id/finish', async (req, reply) => {
    const session = finishSession(req.params.id);
    if (!session) return reply.code(404).send({ message: '会话不存在' });
    return { session: toSessionApi(session) };
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/report', async (req, reply) => {
    const row = getReportRow(req.params.id);
    if (!row) return reply.code(404).send({ message: '报告尚未生成' });
    return { report: toReportApi(row) };
  });

  /** 生成报告。耗时较长，且幂等：已存在则直接返回。 */
  app.post<{ Params: { id: string } }>('/sessions/:id/report', async (req, reply) => {
    try {
      const row = await generateReport(req.params.id);
      return { report: toReportApi(row) };
    } catch (err) {
      if (err instanceof ReportError) return reply.code(400).send({ message: err.message });
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ message: `报告生成失败：${message}` });
    }
  });
};

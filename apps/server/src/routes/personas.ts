import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';

import { all, get, nowIso, run } from '../db/index.js';

interface PersonaRow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  builtin: number;
  sort_order: number;
  created_at: string;
}

function toApi(row: PersonaRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    builtin: row.builtin === 1,
  };
}

interface PersonaBody {
  name?: string;
  description?: string;
  prompt?: string;
}

export const personaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/personas', async () => {
    const rows = all<PersonaRow>('SELECT * FROM personas ORDER BY sort_order ASC, created_at ASC');
    return { personas: rows.map(toApi) };
  });

  app.post<{ Body: PersonaBody }>('/personas', async (req, reply) => {
    const name = req.body?.name?.trim();
    const prompt = req.body?.prompt?.trim();
    if (!name) return reply.code(400).send({ message: '面试官名称不能为空' });
    if (!prompt) return reply.code(400).send({ message: '面试官提示词不能为空' });

    const id = randomUUID();
    // 自建的排在所有内置面试官之后
    const maxOrder = get<{ maxOrder: number | null }>(
      'SELECT MAX(sort_order) AS maxOrder FROM personas WHERE builtin = 0',
    );
    const sortOrder = (maxOrder?.maxOrder ?? 1000) + 10;

    run(
      `INSERT INTO personas (id, name, description, prompt, builtin, sort_order, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      id,
      name,
      req.body?.description?.trim() ?? '',
      prompt,
      sortOrder,
      nowIso(),
    );

    const row = get<PersonaRow>('SELECT * FROM personas WHERE id = ?', id);
    return reply.code(201).send({ persona: row ? toApi(row) : null });
  });

  app.put<{ Params: { id: string }; Body: PersonaBody }>('/personas/:id', async (req, reply) => {
    const row = get<PersonaRow>('SELECT * FROM personas WHERE id = ?', req.params.id);
    if (!row) return reply.code(404).send({ message: '面试官不存在' });
    if (row.builtin === 1) {
      return reply.code(403).send({ message: '内置面试官不可修改，可另存为自定义面试官' });
    }

    const name = req.body?.name?.trim() ?? row.name;
    const prompt = req.body?.prompt?.trim() ?? row.prompt;
    if (!name) return reply.code(400).send({ message: '面试官名称不能为空' });
    if (!prompt) return reply.code(400).send({ message: '面试官提示词不能为空' });

    run(
      `UPDATE personas SET name = ?, description = ?, prompt = ? WHERE id = ?`,
      name,
      req.body?.description?.trim() ?? row.description,
      prompt,
      req.params.id,
    );

    const updated = get<PersonaRow>('SELECT * FROM personas WHERE id = ?', req.params.id);
    return { persona: updated ? toApi(updated) : null };
  });

  app.delete<{ Params: { id: string } }>('/personas/:id', async (req, reply) => {
    const row = get<PersonaRow>('SELECT * FROM personas WHERE id = ?', req.params.id);
    if (!row) return reply.code(404).send({ message: '面试官不存在' });
    if (row.builtin === 1) {
      return reply.code(403).send({ message: '内置面试官不可删除' });
    }

    run('DELETE FROM personas WHERE id = ?', req.params.id);
    return reply.code(204).send();
  });
};

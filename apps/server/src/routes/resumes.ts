import type { FastifyPluginAsync } from 'fastify';

import { extractPdfText, ResumeParseError } from '../services/resumeParser.js';
import {
  deleteResume,
  getResumeRow,
  insertResume,
  listResumeRows,
  parseResumeInBackground,
  toResumeApi,
} from '../services/resumeService.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB，正常简历远小于此

export const resumeRoutes: FastifyPluginAsync = async (app) => {
  app.post('/resumes', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_FILE_BYTES } });
    if (!file) {
      return reply.code(400).send({ message: '未收到上传的文件' });
    }

    const isPdf =
      file.mimetype === 'application/pdf' || file.filename.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      return reply.code(400).send({ message: '目前只支持 PDF 格式的简历' });
    }

    const buffer = await file.toBuffer();
    if (buffer.length === 0) {
      return reply.code(400).send({ message: '文件内容为空' });
    }

    let rawText: string;
    try {
      rawText = await extractPdfText(buffer);
    } catch (err) {
      const message = err instanceof ResumeParseError ? err.message : 'PDF 解析失败';
      return reply.code(422).send({ message });
    }

    const id = insertResume({
      filename: file.filename,
      mime: file.mimetype,
      sizeBytes: buffer.length,
      rawText,
    });

    // 大模型解析耗时可能较长（本地模型尤其），放到后台跑，前端轮询状态
    void parseResumeInBackground(id);

    const row = getResumeRow(id);
    return reply.code(201).send({ resume: row ? toResumeApi(row) : null });
  });

  app.get('/resumes', async () => ({
    resumes: listResumeRows().map(toResumeApi),
  }));

  app.get<{ Params: { id: string } }>('/resumes/:id', async (req, reply) => {
    const row = getResumeRow(req.params.id);
    if (!row) return reply.code(404).send({ message: '简历不存在' });
    return { resume: toResumeApi(row) };
  });

  app.delete<{ Params: { id: string } }>('/resumes/:id', async (req, reply) => {
    const row = getResumeRow(req.params.id);
    if (!row) return reply.code(404).send({ message: '简历不存在' });
    deleteResume(req.params.id);
    return reply.code(204).send();
  });
};

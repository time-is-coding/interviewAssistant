import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import './db/seed.js';
import { DB_PATH, PROJECT_ROOT } from './db/index.js';
import { personaRoutes } from './routes/personas.js';
import { resumeRoutes } from './routes/resumes.js';
import { sessionRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '127.0.0.1';

const app = Fastify({
  logger: {
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  },
});

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

app.get('/api/health', async () => ({ ok: true, dbPath: DB_PATH }));

await app.register(settingsRoutes, { prefix: '/api' });
await app.register(resumeRoutes, { prefix: '/api' });
await app.register(personaRoutes, { prefix: '/api' });
await app.register(sessionRoutes, { prefix: '/api' });

// 生产模式：前端已构建时，由同一个端口托管静态资源。
// 开发时前端跑在 Vite dev server 上，这里判断到目录不存在就跳过。
const webDist = resolve(PROJECT_ROOT, 'apps/web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });

  // 前端是单页应用，非 /api 的路径一律回落到 index.html 交给路由处理
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      return reply.code(404).send({ message: '接口不存在' });
    }
    return reply.sendFile('index.html');
  });

  app.log.info(`已托管前端构建产物：${webDist}`);
}

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`数据库：${DB_PATH}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

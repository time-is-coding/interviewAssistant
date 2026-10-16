/**
 * 启动时写入内置数据。
 * 内置面试官用 upsert，方便后续在代码里改进提示词后自动生效；
 * 用户自建的面试官是独立 id，不受影响。
 */
import { nowIso, run } from './index.js';
import { PERSONA_PRESETS } from '../llm/personas.js';

function seedPersonas(): void {
  for (const p of PERSONA_PRESETS) {
    run(
      `INSERT INTO personas (id, name, description, prompt, builtin, sort_order, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         prompt = excluded.prompt,
         sort_order = excluded.sort_order`,
      p.id,
      p.name,
      p.description,
      p.prompt,
      p.sortOrder,
      nowIso(),
    );
  }
}

seedPersonas();

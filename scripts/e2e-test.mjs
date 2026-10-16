/**
 * 端到端验证：上传简历 → 建会话 → 多轮作答 → 结束 → 生成报告。
 *
 * 用法：node scripts/e2e-test.mjs [baseUrl] [pdfPath]
 * 默认针对本地服务与测试简历。回答故意答得很浅，用于验证评分是否真的不迎合。
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3001';
const PDF = process.argv[3] ?? 'C:/Users/Administrator/AppData/Local/Temp/test-resume.pdf';

const DIFFICULTY = 4;
const PERSONA = 'bytedance';

/** 故意写得很敷衍的回答，用于检验报告会不会给出低分和直白评价。 */
const ANSWERS = [
  '就是按用户 ID 取模分到不同的库，具体怎么实现的记不太清了，当时是照着文档做的。',
  '缓存用的是 Redis，就是普普通通的 key-value 存一下，好像没遇到什么问题。',
  '消息队列迁移就是把 RabbitMQ 换成 Kafka，因为 Kafka 吞吐量更高一些。',
  '分片引擎大概就是用一致性哈希吧，扩容的时候影响比较小，其他细节我负责的不是这块。',
];

const line = (s = '') => console.log(s);
const step = (s) => console.log(`\n=== ${s} ===`);

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`返回内容不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
  }
}

/** 发请求并断言成功，失败时把服务端给的中文错误抛出来。 */
async function call(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const body = res.status === 204 ? null : await json(res);
  if (!res.ok) throw new Error(`${path} 失败（HTTP ${res.status}）：${body?.message ?? '未知错误'}`);
  return body;
}

const postJson = (path, payload = {}) =>
  call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

/* ------------------------------ 1. 上传简历 ------------------------------ */

step('上传简历');
const { readFile } = await import('node:fs/promises');
const buffer = await readFile(PDF);
const form = new FormData();
form.append('file', new Blob([buffer], { type: 'application/pdf' }), 'resume.pdf');

const uploaded = await call('/api/resumes', { method: 'POST', body: form });
line(`简历 id：${uploaded.resume.id}，原文 ${uploaded.resume.rawTextLength} 字`);

// 等待大模型解析（本地模型可能需要十几秒）
process.stdout.write('等待画像解析');
let resume = uploaded.resume;
for (let i = 0; i < 40; i += 1) {
  await new Promise((r) => setTimeout(r, 3000));
  process.stdout.write('.');
  resume = (await call(`/api/resumes/${resume.id}`)).resume;
  if (resume.parseStatus === 'done' || resume.parseStatus === 'failed') break;
}
line(`\n解析状态：${resume.parseStatus}`);
if (resume.parseStatus !== 'done') {
  throw new Error(`画像解析失败：${resume.parseError}`);
}

const points = resume.profile.assessmentPoints ?? [];
line(`目标岗位：${resume.profile.targetRole}｜年限：${resume.profile.yearsOfExperience}`);
line(`技术栈：${(resume.profile.techStack ?? []).join('、')}`);
line(`考察要点 ${points.length} 条：`);
for (const p of points) line(`  - ${p}`);

/* ------------------------------ 2. 建会话 ------------------------------ */

step(`创建面试会话（L${DIFFICULTY} + ${PERSONA}）`);
const created = await postJson('/api/sessions', {
  resumeId: resume.id,
  difficulty: DIFFICULTY,
  personaId: PERSONA,
});
const sessionId = created.session.id;
line(`会话 id：${sessionId}｜上限 ${created.session.maxRounds} 轮`);
line(`面试官 ${created.session.personaName} 的开场：`);
line(`  ${created.session.messages[0].content}`);

/* ------------------------------ 3. 逐轮作答 ------------------------------ */

for (const [index, answer] of ANSWERS.entries()) {
  step(`第 ${index + 1} 轮`);
  line(`候选人：${answer}`);

  const res = await fetch(`${BASE}/api/sessions/${sessionId}/turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: answer, inputMode: 'keyboard' }),
  });

  // 逐帧读取 SSE，验证流式确实在推
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = null;
  let deltaCount = 0;

  for (;;) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!raw.startsWith('data:')) continue;
      const event = JSON.parse(raw.slice(5).trim());
      if (event.type === 'delta') deltaCount += 1;
      if (event.type === 'done') done = event;
      if (event.type === 'error') throw new Error(`服务端错误：${event.message}`);
    }
  }

  line(`（流式分 ${deltaCount} 段推送）`);
  line(`面试官：${done?.message.content ?? '（无回复）'}`);
  line(`轮次：${done?.roundCount}｜问号个数：${(done?.message.content.match(/？/g) ?? []).length}`);
  if (done?.ended) {
    line('→ 已达轮次上限，面试自动结束');
    break;
  }
}

/* ------------------------------ 4. 结束与评分 ------------------------------ */

const detail = await call(`/api/sessions/${sessionId}`);
line(`\n已覆盖考察要点 ${detail.session.coverage.length} / ${points.length} 条：`);
for (const c of detail.session.coverage) line(`  - ${c}`);

step('结束面试并生成报告');
await postJson(`/api/sessions/${sessionId}/finish`);

const reportRes = await fetch(`${BASE}/api/sessions/${sessionId}/report`, { method: 'POST' });
const reportBody = await json(reportRes);
if (!reportRes.ok) throw new Error(`报告生成失败：${reportBody.message}`);
const report = reportBody.report;

line(`\n总分 ${report.overall} / 100 ｜ 结论：${report.recommendation} ｜ 按 ${report.evaluatedAtLevel} 标准`);
line(`\n整体判断：${report.summary}\n`);
line('维度得分：');
for (const d of report.dimensions) {
  line(`  ${d.name.padEnd(12)} ${String(d.score).padStart(3)} 分（权重 ${(d.weight * 100).toFixed(0)}%）`);
}

line(`\n明确指出「做得好的地方」${report.strengths.length} 条：`);
for (const s of report.strengths) line(`  - ${s.point}`);

line(`\n明确指出「问题」${report.weaknesses.length} 条：`);
for (const w of report.weaknesses) line(`  - ${w.point}${w.evidence ? `（${w.evidence}）` : ''}`);

line(`\n简历本身的问题 ${report.resumeConcerns.length} 条：`);
for (const c of report.resumeConcerns) line(`  - ${c}`);

line(`\n下一步建议 ${report.nextSteps.length} 条：`);
for (const s of report.nextSteps) line(`  - ${s}`);

/* ------------------------------ 5. 反迎合断言 ------------------------------ */

step('反迎合校验');
const FLATTERY = ['表现不错', '继续加油', '潜力很大', '相信你会', '非常好', '很棒', '优秀的表现', '感谢分享'];
const fullText = `${report.summary}\n${report.markdown}`;
const hits = FLATTERY.filter((w) => fullText.includes(w));
line(`套话检测：${hits.length ? `发现 ${hits.join('、')} —— 不合格` : '未发现鼓励性套话 —— 通过'}`);

const evidenceCount = report.dimensions.reduce((n, d) => n + d.evidence.length, 0);
line(`证据引用总数：${evidenceCount} 条${evidenceCount === 0 ? ' —— 不合格，没有引用原话' : ' —— 通过'}`);
line(`总分是否偏低（<70，敷衍作答应当如此）：${report.overall < 70 ? '是 —— 通过' : '否 —— 需人工复核'}`);

console.log('\n报告 Markdown 已存入数据库（reports.markdown），长度', report.markdown.length);

/**
 * 生成一份用于端到端验证的测试简历 PDF。
 * 用法：node scripts/make-test-resume.mjs <输出路径>
 */
import { writeFileSync } from 'node:fs';

const lines = [
  'Zhang Wei',
  'Email: zhangwei@example.com   Phone: 138-0000-0000',
  '',
  'TARGET ROLE: Senior Backend Engineer',
  'YEARS OF EXPERIENCE: 6 years',
  '',
  'TECH STACK: Java, Spring Boot, MySQL, Redis, Kafka, Docker, Kubernetes, gRPC',
  '',
  'WORK EXPERIENCE',
  'Meituan    2021.03 - Present    Senior Backend Engineer',
  '  Led the redesign of the order dispatch service, peak 200k QPS.',
  '  Reduced p99 latency from 850ms to 120ms via local cache and async IO.',
  '',
  'ByteDance  2019.07 - 2021.02    Backend Engineer',
  '  Built the comment service for a short video app with 50M DAU.',
  '  Migrated the message queue from RabbitMQ to Kafka, cut cost by 30%.',
  '',
  'PROJECTS',
  'Order Dispatch System (2022.01 - 2023.06)',
  '  Tech: Java, Spring Boot, Redis, Kafka, Kubernetes',
  '  Designed a sharded dispatch engine. Owned the caching layer and the',
  '  degrade strategy during peak traffic. Proficient in distributed transactions.',
  '',
  'EDUCATION',
  'Beijing University of Posts and Telecommunications',
  '  2015 - 2019  Computer Science, Bachelor',
  '',
  'SELF EVALUATION',
  'Proficient in distributed system design. Strong ownership. Good at firefighting.',
];

const escape = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const firstLine = lines[0] ?? '';
const restLines = lines.slice(1);
const content = [
  'BT',
  '/F1 11 Tf',
  '14 TL',
  '50 800 Td',
  `(${escape(firstLine)}) Tj`,
  ...restLines.map((l) => `T* (${escape(l)}) Tj`),
  'ET',
].join('\n');

const objects = {
  1: '<< /Type /Catalog /Pages 2 0 R >>',
  2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
     '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  4: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  5: `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
};

let pdf = '%PDF-1.4\n';
const offsets = {};
for (const [num, body] of Object.entries(objects)) {
  offsets[num] = Buffer.byteLength(pdf, 'latin1');
  pdf += `${num} 0 obj\n${body}\nendobj\n`;
}

const xrefStart = Buffer.byteLength(pdf, 'latin1');
pdf += 'xref\n0 6\n0000000000 65535 f \n';
for (let i = 1; i <= 5; i += 1) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = process.argv[2] ?? 'test-resume.pdf';
writeFileSync(out, Buffer.from(pdf, 'latin1'));
console.log(`已生成测试简历：${out}`);

/**
 * 宽松 JSON 解析。
 *
 * 本地小模型即使被要求「只输出 JSON」，也常会带上 ```json 代码块、
 * 前后解释性文字，或漏掉结尾括号。这里做尽力而为的提取，
 * 尽量不让一次格式抖动毁掉整条流程。
 */
export function parseJsonLoose<T>(raw: string): T {
  const text = raw.trim();

  // 1. 直接解析
  const direct = tryParse<T>(text);
  if (direct !== undefined) return direct;

  // 2. 剥掉 markdown 代码块
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) {
    const parsed = tryParse<T>(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }

  // 3. 取第一个配平的 { ... } 块
  const block = extractBalancedObject(text);
  if (block) {
    const parsed = tryParse<T>(block);
    if (parsed !== undefined) return parsed;
  }

  throw new Error('模型返回的内容不是合法 JSON');
}

function tryParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** 从任意文本中摘出第一个花括号配平的 JSON 对象，跳过字符串内的花括号。 */
function extractBalancedObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // 没有配平（多半是模型被截断），补上结尾括号再试
  return `${text.slice(start)}}`;
}

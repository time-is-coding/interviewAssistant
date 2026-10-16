/**
 * 中文文本的近似匹配工具。
 *
 * 用途一：判定面试覆盖度——拿面试官的问题去比对「可考察要点」。
 * 用途二：给模型输出做去重兜底——小模型不遵守「不要重复」这类提示词约束，
 * 与其反复加提示词，不如在应用层做确定性过滤。
 *
 * 中文没有分词，用字符二元组（bigram）重合度做近似：对「同一件事的不同说法」
 * 足够有效，也不需要引入分词依赖。
 */

/** 取字符二元组集合，剔除空白、标点与符号。 */
function bigrams(text: string): Set<string> {
  const clean = text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
  const grams = new Set<string>();
  for (let i = 0; i < clean.length - 1; i += 1) {
    grams.add(clean.slice(i, i + 2));
  }
  // 单字文本退化为单字符集合，避免空集
  if (grams.size === 0 && clean.length === 1) grams.add(clean);
  return grams;
}

/**
 * 相似度 = 命中二元组数 / 较短一方的二元组数。
 *
 * 取较短一方作分母，让「短句是长句的一部分」也能得到高分——
 * 面试官的问题往往比要点短，用长边作分母会永远匹配不上。
 */
function similarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return 0;

  let hit = 0;
  for (const gram of ga) {
    if (gb.has(gram)) hit += 1;
  }
  return hit / Math.min(ga.size, gb.size);
}

/* ------------------------------ 覆盖度 ------------------------------ */

/** 命中阈值。太低会误标已覆盖，太高则覆盖度几乎不涨。 */
const COVERAGE_THRESHOLD = 0.34;

/**
 * 判断本轮问题考察到了哪些要点。
 * 面试是连续的，一个要点常分多轮追问；只要某一轮命中了就算已考察。
 */
export function detectCoveredPoints(recentQuestions: string[], uncoveredPoints: string[]): string[] {
  if (recentQuestions.length === 0) return [];
  const text = recentQuestions.join('\n');

  return uncoveredPoints.filter((point) => similarity(text, point) >= COVERAGE_THRESHOLD);
}

/* ------------------------------ 去重 ------------------------------ */

/** 两条文本近义到何种程度算重复。 */
const DUPLICATE_THRESHOLD = 0.6;

/**
 * 去掉近义重复的条目，保留先出现的那条。
 *
 * 应对「高峰流量期间缓存层的设计」与「在高峰流量期间负责缓存层的设计与维护」
 * 这类换词重述。
 */
export function dedupePoints<T extends string>(points: T[]): T[] {
  const kept: T[] = [];

  for (const point of points) {
    const trimmed = typeof point === 'string' ? point.trim() : '';
    if (!trimmed) continue;

    const isDuplicate = kept.some((existing) => similarity(existing, trimmed) >= DUPLICATE_THRESHOLD);
    if (!isDuplicate) kept.push(point);
  }

  return kept;
}

/**
 * 一段文本与一组文本的最大相似度。
 *
 * 用于检查报告的某个结论在面试实录里到底有没有依据：
 * 与候选人所有回答的最高相似度都很低，说明这句话不是从面试里来的。
 */
export function maxSimilarity(text: string, corpus: string[]): number {
  let best = 0;
  for (const item of corpus) {
    const score = similarity(text, item);
    if (score > best) best = score;
  }
  return best;
}

/**
 * 从 items 中剔除与 others 近义重复的条目。
 *
 * 用于报告规整：模型常把 weaknesses 的内容原样再抄一遍到 resumeConcerns，
 * 但那两个字段要表达的是不同的东西（面试表现 vs 简历本身的问题）。
 */
export function filterDuplicatesAgainst(items: string[], others: string[]): string[] {
  if (others.length === 0) return items;

  return items.filter(
    (item) => !others.some((other) => similarity(item, other) >= DUPLICATE_THRESHOLD),
  );
}

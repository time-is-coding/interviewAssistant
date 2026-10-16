/**
 * 面试官回复的文本规整。
 *
 * 提示词里已经写明「只问一个问题」「不要输出标记」，但本地小模型并不可靠。
 * 与其反复加提示词约束，不如在应用层做确定性兜底——
 * 原始回复会完整存进 messages.meta_json，方便排查。
 */

/**
 * 清理模型回复里可能残留的标记。
 *
 * 模型会模仿提示词里出现过的格式，产出 HTML 注释或半截的进度标记
 * （实测出现过 `|.covered: 分片调度引擎设计 |`），这类内容不能给候选人看到。
 */
export function stripStrayMarkers(text: string): string {
  return text
    // 完整的 HTML 注释
    .replace(/<!--[\s\S]*?-->/g, '')
    // 半截标记：短行、以竖线开头、含 covered 或 覆盖
    .replace(/^\s*\|[^\n]{0,60}(?:covered|覆盖)[^\n]{0,60}\|\s*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 首个问句短于这个长度时不截断，免得把真正的提问切掉。 */
const MIN_FIRST_QUESTION = 9;

/**
 * 只保留第一个问题。
 *
 * 实测模型喜欢先抛出主问题、再追加「为什么」「有没有遇到困难」这类追问，
 * 一口气问两三个问题会让候选人只答其中一个，追问逻辑也随之混乱。
 * 模型通常把主问题放在前面，因此截到第一个问号即可。
 *
 * 若首个问句过短（更像是「能说明一下吗？」这类过渡句），则不截断，
 * 宁可保留多个问题也不要问出一个没有信息量的问题。
 */
export function enforceSingleQuestion(text: string): string {
  const firstMark = text.indexOf('？');
  if (firstMark < 0) return text;

  // 只有一个问号，本来就是单问题
  if (text.indexOf('？', firstMark + 1) < 0) return text;

  const head = text.slice(0, firstMark + 1).trim();
  if (head.length < MIN_FIRST_QUESTION) return text;

  return head;
}

/** 面试官回复的统一后处理入口。 */
export function cleanInterviewerReply(raw: string): string {
  const stripped = stripStrayMarkers(raw) || raw.trim();
  return enforceSingleQuestion(stripped);
}

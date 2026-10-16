import { PDFParse } from 'pdf-parse';

export class ResumeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeParseError';
  }
}

/**
 * 从 PDF 中抽取纯文本。
 *
 * 注意：扫描件（图片型 PDF）抽不出文字，这里会明确报错而不是返回空串，
 * 让前端能给出一句可操作的提示。
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = normalize(result.text ?? '');
    if (text.length < 20) {
      throw new ResumeParseError(
        '未能从该 PDF 中提取到文字。如果这是扫描件或图片型简历，请换一份可复制文字的 PDF。',
      );
    }
    return text;
  } catch (err) {
    if (err instanceof ResumeParseError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ResumeParseError(`PDF 解析失败：${message}`);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/** 统一换行、压掉多余空行，减少后续喂给模型的噪声。 */
function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 控制喂给模型的简历长度，避免超出上下文。 */
export function truncateForModel(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n（简历过长，已截断）`;
}

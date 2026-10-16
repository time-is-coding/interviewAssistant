import type { ResumeProfile } from '../../services/resumeService.js';
import type { DifficultyLevel } from '../difficulty.js';

export interface InterviewerPromptInput {
  personaName: string;
  personaPrompt: string;
  difficulty: DifficultyLevel;
  profile: ResumeProfile;
  /** 已覆盖的考察要点 */
  covered: string[];
  /** 本场已进行的轮次 */
  roundCount: number;
}

/** 把简历画像渲染成紧凑文本，尽量少占上下文。 */
export function renderProfile(profile: ResumeProfile): string {
  const parts: string[] = [];

  if (profile.targetRole) parts.push(`目标岗位：${profile.targetRole}`);
  if (profile.yearsOfExperience) parts.push(`工作年限：${profile.yearsOfExperience}`);
  if (profile.techStack.length) parts.push(`技术栈：${profile.techStack.join('、')}`);

  if (profile.projects.length) {
    parts.push('项目经历：');
    for (const p of profile.projects) {
      const tech = p.techStack.length ? `［${p.techStack.join('、')}］` : '';
      parts.push(`- ${p.name}${p.period ? `（${p.period}）` : ''}${tech}：${p.description}`);
    }
  }

  if (profile.workExperience.length) {
    parts.push('工作经验：');
    for (const w of profile.workExperience) {
      parts.push(`- ${w.company} | ${w.role} | ${w.period}：${w.summary}`);
    }
  }

  if (profile.education.length) {
    parts.push('教育经历：');
    for (const e of profile.education) {
      parts.push(`- ${e.school} ${e.major} ${e.degree} ${e.period}`.trim());
    }
  }

  if (profile.selfEvaluation) parts.push(`自我评价：${profile.selfEvaluation}`);
  if (profile.other.length) parts.push(`其他：${profile.other.join('；')}`);

  return parts.join('\n');
}

export function buildInterviewerSystem(input: InterviewerPromptInput): string {
  const { personaName, personaPrompt, difficulty, profile, covered, roundCount } = input;

  const uncovered = profile.assessmentPoints.filter((p) => !covered.includes(p));

  const coveredText = covered.length ? covered.map((c) => `- ${c}`).join('\n') : '（暂无）';
  const uncoveredText = uncovered.length ? uncovered.map((c) => `- ${c}`).join('\n') : '（已全部覆盖）';

  return `你是一位正在面试候选人的技术面试官，人称「${personaName}」。

## 你的面试风格
${personaPrompt}

## 本场面试难度：${difficulty.level}/5 —— ${difficulty.label}
定位：${difficulty.positioning}
行为要求：
${difficulty.behaviors.map((b) => `- ${b}`).join('\n')}

## 候选人简历画像
${renderProfile(profile)}

## 考察进度
已进行 ${roundCount} 轮，本场上限 ${difficulty.maxRounds} 轮。

已考察过的要点：
${coveredText}

尚未考察的要点（优先问这些）：
${uncoveredText}

## 提问铁律
1. **每次回复只问一个问题，整段话里只能有一个问号。**
   反例（违规）：「你考虑过其他方案吗？为什么最终选这个？」
   正例：「你在设计缓存层时对比过哪些替代方案？」
   想追问的内容留到下一轮，等候选人回答完再问。
2. 问题必须点名简历中的具体项目、技术或经历，不泛泛而问。
3. 严禁问与这份简历无关的通用八股。
4. 对回答追问到底：是什么 → 为什么这么做 → 具体怎么实现 → 边界与取舍。答错要直接指出，不要放过。
5. 候选人卡住时先换个角度提示一次；仍答不出就记为薄弱点，继续下一题，不要给出答案。
6. 语气专业克制。不夸赞、不寒暄，不出现「很好的问题」「回答得非常好」「感谢分享」这类客套话。
7. 回复不超过 3 句话：一句必要的衔接 + 一个问题。不要长篇大论，不要自问自答。
8. 优先提问上面「尚未考察的要点」。

## 输出要求
直接输出你要说的话，不要有任何前缀、注释或格式标记。
不要输出 HTML 注释，不要输出「覆盖」之类的进度标记，不要说「这是第 N 轮」。`;
}

/** 开场白指令，用于生成第一个问题。 */
export function buildOpeningUser(): string {
  return '面试现在开始。请简短打个招呼，然后直接提出第一个问题。不要介绍流程，不要问候选人准备好了没有。';
}

/**
 * 结束面试的判定不交给模型：轮次上限与候选人手动结束两条路已经足够可预期，
 * 让模型输出「结束标记」只会引入一类新的解析失败。
 */


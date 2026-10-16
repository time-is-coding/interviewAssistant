import type { MessageRow } from '../../services/interviewEngine.js';
import type { ResumeProfile } from '../../services/resumeService.js';
import type { DifficultyLevel } from '../difficulty.js';
import { renderProfile } from './interviewer.js';

export interface DimensionDef {
  key: string;
  name: string;
  weight: number;
}

/** 基础六维。权重来自需求确认：项目回答最重。 */
const BASE_DIMENSIONS: DimensionDef[] = [
  { key: 'fundamentals', name: '基础知识', weight: 0.2 },
  { key: 'project', name: '项目回答', weight: 0.25 },
  { key: 'problemSolving', name: '解决问题能力', weight: 0.2 },
  { key: 'depth', name: '知识深度', weight: 0.15 },
  { key: 'breadth', name: '知识广度', weight: 0.1 },
  { key: 'communication', name: '语言表达能力', weight: 0.1 },
];

/** L5 额外考察的两维。 */
const LEVEL5_EXTRA_DIMENSIONS: DimensionDef[] = [
  { key: 'productIndustry', name: '产品与行业思考', weight: 0.1 },
  { key: 'industryInfluence', name: '行业沉淀与影响力', weight: 0.1 },
];

/**
 * 取该难度档的评分维度。
 *
 * L5 在六维之外加两维，六维权重按比例缩到 80%，新两维各占 10%，合计仍为 100%。
 */
export function getDimensionsForDifficulty(level: number): DimensionDef[] {
  if (level !== 5) return BASE_DIMENSIONS;

  return [
    ...BASE_DIMENSIONS.map((d) => ({ ...d, weight: round2(d.weight * 0.8) })),
    ...LEVEL5_EXTRA_DIMENSIONS,
  ];
}

function round2(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function buildReportSystem(difficulty: DifficultyLevel, dimensions: DimensionDef[]): string {
  const dimensionTable = dimensions
    .map((d) => `- ${d.name}（key: ${d.key}，权重 ${(d.weight * 100).toFixed(0)}%）`)
    .join('\n');

  return `你是一位严格的技术面试官，现在要评估一份模拟面试的完整记录，并出具书面评估报告。

## 评估基准
本次面试按「L${difficulty.level} ${difficulty.label}」的标准进行。
该档定位：${difficulty.positioning}
所有分数和判断都以此为准：这个档位要求什么水平，候选人达到了没有。

## 评分铁律（必须严格遵守）
1. 宁可偏低，不要偏高。评分要经得起同行复核。
2. 不要因为候选人态度好、表达礼貌、努力尝试、配合度高而加分。只评估面试中展现出的能力证据。
3. 每一个加分或扣分都必须引用候选人的原话作为证据。找不到原话支撑的判断，不要写。
4. **没有内容的回答等于没有证据。** 候选人用「记不太清了」「不是我负责的」「照着文档做的」
   「普普通通」「没遇到什么问题」「大概就是这样」这类话搪塞过去的，该维度直接给 0 到 30 分。
5. 某个维度如果完全没有可评估的证据，给 0 到 30 分，并在 evidence 里注明「本场面试未考察到」。
6. 不要写鼓励性套话。「表现不错」「继续加油」「潜力很大」「相信你会更好」这类话一律不要出现。
7. **不要和稀泥。** summary 里禁止出现「整体表现一般」「尚可」「还不错」「有待提升」这类
   模糊表述。直接说清楚：这人能做什么、不能做什么、差在哪一个具体点上。
8. 做得不好的地方必须明确写出来，不能只写优点，也不能用委婉说法带过。
9. strengths 只能写本场面试中确实展现出证据的优点。仅凭简历上写了什么就夸「项目经历丰富」
   属于无依据评价，禁止。本场面试没有值得肯定的地方时，strengths 返回空数组，宁可空着也不要凑。
10. resumeConcerns 只写简历本身的问题（措辞夸大、与面试表现不符、描述含糊），
    不要在这里把面试表现的问题重复写一遍。
11. 如果有效回答少于 3 轮，必须在 summary 里写明「样本不足，结论置信度低」。

## 评分锚点
分数必须拉开差距——认真作答和敷衍作答要能体现在分数上。一个把「记不清了」挂在嘴边的候选人，
不应该拿到及格分。

- 90-100：达到该难度下的优秀水平，几乎所有追问都能答到原理与取舍层面
- 75-89：良好，主干问题答得清楚，个别点可以更深
- 60-74：及格。基本概念和项目主干能讲清楚，只是深度不足
- 40-59：未达到该难度的要求。只能说出名词，讲不清做法与原因
- 0-39：严重不匹配。回避问题、答非所问，或几乎没有提供有效信息

## 评分维度与权重
${dimensionTable}

## 输出格式
只输出一个 JSON 对象。不要任何解释文字，不要 markdown 代码块，不要前后缀。

{
  "overallScore": 0 到 100 的整数,
  "recommendation": "推荐" 或 "待定" 或 "不推荐",
  "summary": "2 到 3 句直言不讳的整体判断，直接给结论，不要客套",
  "dimensions": [
    {
      "key": "上面表格里的 key",
      "score": 0 到 100 的整数,
      "summary": "该维度的一句话结论",
      "evidence": [
        { "quote": "候选人原话，逐字引用", "comment": "这句话说明了什么" }
      ],
      "advice": "针对该维度可执行的改进建议，要点名具体技术点"
    }
  ],
  "strengths": [ { "point": "确实做得好的地方", "evidence": "对应的原话，必填" } ],
  "weaknesses": [ { "point": "明确的问题", "evidence": "对应的原话或具体表现" } ],
  "resumeConcerns": [ "简历本身的问题，没有则空数组" ],
  "suggestedAnswerOutline": [
    { "question": "面试中被问到的原问题", "betterAnswer": "一个更好的回答应该覆盖哪些要点" }
  ],
  "nextSteps": [ "接下来优先补强的方向，按优先级从高到低" ]
}

关于 resumeConcerns：必须认真比对简历与面试表现。简历上写了、但面试中答不出来或者含糊其辞的内容；
用了「精通」「主导」「从 0 到 1」「大幅提升」这类强措辞却没有相应证据的，都要在这里逐条指出。
如果确实没有发现问题，返回空数组。

关于 dimensions：必须为上面表格里的每一个 key 都输出一项，顺序与表格一致。`;
}

export function buildReportUser(params: {
  profile: ResumeProfile;
  personaName: string;
  difficulty: DifficultyLevel;
  messages: MessageRow[];
}): string {
  const { profile, personaName, difficulty, messages } = params;

  const transcript = messages
    .map((m) => `${m.role === 'interviewer' ? '面试官' : '候选人'}：${m.content}`)
    .join('\n\n');

  const candidateAnswers = messages.filter((m) => m.role === 'candidate');

  return `## 面试信息
面试官：${personaName}
难度：L${difficulty.level} ${difficulty.label}
候选人有效回答轮数：${candidateAnswers.length}

## 候选人简历画像
${renderProfile(profile)}

## 完整面试记录
${transcript}

## 任务
根据以上记录，按系统提示词中的要求输出评估报告的 JSON。`;
}

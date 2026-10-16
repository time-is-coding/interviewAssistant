import type { ReportDimension } from '../api/types.ts';

/**
 * 维度得分条形图。
 *
 * 设计取舍（依可视化规范）：
 * - 维度得分是「同一个测度跨多个类别」，不是多个系列，因此用单一色相 + 直接标数值，
 *   不按分数高低改变颜色——分数本身就是长度，再用颜色分级只会变成重复编码，
 *   也容易让颜色代替文字去表达判断。
 * - 不画坐标轴、不画网格：每条直接标数值，读起来更快，也少一层视觉噪声。
 * - 及格线用一条参考线标出，给分数提供语境。
 */

/** 及格线。与报告结论的分档保持一致。 */
const PASS_LINE = 60;

const BAR_COLOR = '#3987e5';

function ScoreBar({ dimension }: { dimension: ReportDimension }) {
  const { name, score, weight, summary } = dimension;

  return (
    <div
      className="group grid grid-cols-[6.5rem_1fr_2.5rem] items-center gap-3"
      title={`${name}：${score} 分（权重 ${(weight * 100).toFixed(0)}%）${summary ? `\n${summary}` : ''}`}
    >
      <span className="truncate text-right text-xs text-slate-400">{name}</span>

      <div className="relative h-2 rounded-sm bg-slate-800/50">
        <div
          className="h-full rounded-r transition-[filter] group-hover:brightness-110"
          style={{ width: `${Math.max(score, 0.5)}%`, backgroundColor: BAR_COLOR }}
        />
      </div>

      <span className="text-right text-xs tabular-nums text-slate-300">{score}</span>
    </div>
  );
}

export default function ScoreChart({ dimensions }: { dimensions: ReportDimension[] }) {
  if (dimensions.length === 0) return null;

  return (
    <div className="grid gap-2.5">
      <div className="grid grid-cols-[6.5rem_1fr_2.5rem] gap-3">
        <span />
        <div className="relative h-4">
          <div
            className="absolute top-0 bottom-0 border-l border-dashed border-slate-600"
            style={{ left: `${PASS_LINE}%` }}
          />
          <span
            className="absolute top-0 -translate-x-1/2 text-[10px] whitespace-nowrap text-slate-500"
            style={{ left: `${PASS_LINE}%` }}
          >
            及格线 {PASS_LINE}
          </span>
        </div>
        <span />
      </div>

      {dimensions.map((d) => (
        <ScoreBar key={d.key} dimension={d} />
      ))}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError, api } from '../api/client.ts';
import type { Report } from '../api/types.ts';
import ScoreChart from '../components/ScoreChart.tsx';
import { Card, Notice, PageHeader, buttonSecondary } from '../components/Ui.tsx';

/** 结论对应的状态色。颜色只是辅助，文案本身承载含义，不靠颜色单独表意。 */
const RECOMMENDATION_STYLE: Record<string, string> = {
  推荐: 'border-[#0ca30c]/40 bg-[#0ca30c]/10 text-[#0ca30c]',
  待定: 'border-[#fab219]/40 bg-[#fab219]/10 text-[#fab219]',
  不推荐: 'border-[#d03b3b]/40 bg-[#d03b3b]/10 text-[#d03b3b]',
};

function EvidenceQuote({ quote, comment }: { quote: string; comment: string }) {
  return (
    <li className="border-l-2 border-slate-700 pl-3">
      <p className="text-xs leading-relaxed text-slate-300">「{quote}」</p>
      {comment && <p className="mt-1 text-xs leading-relaxed text-slate-500">{comment}</p>}
    </li>
  );
}

export default function ReportPage() {
  const { sessionId = '' } = useParams();
  const [report, setReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<'loading' | 'scoring' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      // 已有报告直接读；没有则触发生成（模型评分耗时较长）
      try {
        const { report: existing } = await api.getReport(sessionId);
        setReport(existing);
        setStatus('ready');
        return;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 404) throw err;
      }

      setStatus('scoring');
      const { report: generated } = await api.generateReport(sessionId);
      setReport(generated);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setStatus('error');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (status === 'loading') return <p className="text-sm text-slate-500">加载中…</p>;

  if (status === 'scoring') {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="mb-4 flex justify-center">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
        </div>
        <p className="text-sm text-slate-300">正在评估这场面试…</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          评估器需要通读全部对话，逐条引用你的原话作为依据。本地模型通常需要一到两分钟。
        </p>
      </div>
    );
  }

  if (status === 'error' || !report) {
    return (
      <>
        <Notice kind="error">
          {error ?? '报告不可用'}
          <button
            className="ml-3 underline underline-offset-2"
            onClick={() => {
              setStatus('loading');
              setError(null);
              void load();
            }}
          >
            重试
          </button>
        </Notice>
        <div className="mt-4">
          <Link to="/" className={buttonSecondary}>
            返回首页
          </Link>
        </div>
      </>
    );
  }

  const badgeClass = RECOMMENDATION_STYLE[report.recommendation] ?? RECOMMENDATION_STYLE['待定']!;

  return (
    <>
      <PageHeader
        title="面试评估报告"
        description={`评估标准：${report.evaluatedAtLevel} · ${new Date(report.createdAt).toLocaleString('zh-CN')}`}
        actions={
          <Link to="/" className={buttonSecondary}>
            返回首页
          </Link>
        }
      />

      <div className="grid gap-5">
        {/* 总分 */}
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4 rounded-xl border border-slate-800 bg-slate-900/40 px-6 py-5">
          <div>
            <div className="text-xs text-slate-500">总分</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-5xl leading-none font-semibold text-slate-100">
                {report.overall}
              </span>
              <span className="text-sm text-slate-500">/ 100</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">结论</div>
            <div className="mt-1.5">
              <span className={`rounded-md border px-2.5 py-1 text-sm ${badgeClass}`}>
                {report.recommendation}
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-[16rem] border-l border-slate-800 pl-6">
            <div className="text-xs text-slate-500">整体判断</div>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-200">{report.summary}</p>
          </div>
        </div>

        {/* 维度得分 */}
        <Card
          title="维度得分"
          description="总分取各维度加权平均。悬停查看权重与结论。"
        >
          <ScoreChart dimensions={report.dimensions} />
        </Card>

        {/* 明确的问题 —— 放在优点之前 */}
        {report.weaknesses.length > 0 && (
          <Card title={`明确的问题（${report.weaknesses.length}）`}>
            <ul className="grid gap-3">
              {report.weaknesses.map((w, i) => (
                <li key={i}>
                  <p className="text-sm text-slate-200">{w.point}</p>
                  {w.evidence && (
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{w.evidence}</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* 维度详情 */}
        <Card title="逐项证据与建议">
          <div className="grid gap-5">
            {report.dimensions.map((d) => (
              <div key={d.key} className="border-t border-slate-800 pt-4 first:border-t-0 first:pt-0">
                <div className="flex items-baseline gap-3">
                  <h3 className="text-sm font-medium text-slate-200">{d.name}</h3>
                  <span className="text-sm tabular-nums text-slate-300">{d.score} 分</span>
                  <span className="text-xs text-slate-600">
                    权重 {(d.weight * 100).toFixed(0)}%
                  </span>
                </div>

                {d.summary && (
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{d.summary}</p>
                )}

                {d.evidence.length > 0 && (
                  <ul className="mt-3 grid gap-2">
                    {d.evidence.map((e, i) => (
                      <EvidenceQuote key={i} quote={e.quote} comment={e.comment} />
                    ))}
                  </ul>
                )}

                {d.advice && (
                  <p className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs leading-relaxed text-slate-300">
                    <span className="text-slate-500">改进建议：</span>
                    {d.advice}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* 优点。为空时不展示——没有证据支撑的夸奖不如不写 */}
        {report.strengths.length > 0 && (
          <Card title={`做得好的地方（${report.strengths.length}）`}>
            <ul className="grid gap-2.5">
              {report.strengths.map((s, i) => (
                <li key={i}>
                  <p className="text-sm text-slate-200">{s.point}</p>
                  {s.evidence && (
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{s.evidence}</p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* 简历本身的问题 */}
        {report.resumeConcerns.length > 0 && (
          <Card
            title={`简历本身的问题（${report.resumeConcerns.length}）`}
            description="简历写法与面试表现对不上的地方"
          >
            <ul className="grid gap-2">
              {report.resumeConcerns.map((c, i) => (
                <li key={i} className="text-sm leading-relaxed text-slate-300">
                  · {c}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* 更好的答法 */}
        {report.suggestedAnswerOutline.length > 0 && (
          <Card title="答得不好的题目，更好的答法">
            <div className="grid gap-4">
              {report.suggestedAnswerOutline.map((o, i) => (
                <div key={i} className="border-t border-slate-800 pt-3 first:border-t-0 first:pt-0">
                  <p className="text-sm text-slate-200">{o.question}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{o.betterAnswer}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* 下一步 */}
        {report.nextSteps.length > 0 && (
          <Card title="下一步">
            <ol className="grid gap-2">
              {report.nextSteps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-300">
                  <span className="tabular-nums text-slate-600">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </>
  );
}

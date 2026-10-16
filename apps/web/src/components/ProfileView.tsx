import type { ResumeProfile } from '../api/types.ts';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-slate-800 pt-3 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-xs font-medium text-slate-500">{title}</h3>
      {children}
    </div>
  );
}

function Tags({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-sm text-slate-600">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span
          key={t}
          className="rounded border border-slate-700 bg-slate-800/60 px-2 py-0.5 text-xs text-slate-300"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

export default function ProfileView({ profile }: { profile: ResumeProfile | null }) {
  if (!profile) {
    return <p className="text-sm text-slate-500">没有解析出画像内容。</p>;
  }

  return (
    <div className="grid gap-3 text-sm">
      <Section title="目标岗位 / 工作年限">
        <p className="text-slate-200">
          {profile.targetRole || '未写明'}
          <span className="mx-2 text-slate-600">·</span>
          {profile.yearsOfExperience || '未写明'}
        </p>
      </Section>

      <Section title="技术栈">
        <Tags items={profile.techStack} />
      </Section>

      {profile.projects.length > 0 && (
        <Section title={`项目经历（${profile.projects.length}）`}>
          <ul className="grid gap-2.5">
            {profile.projects.map((p, i) => (
              <li key={`${p.name}-${i}`}>
                <div className="text-slate-200">
                  {p.name}
                  {p.period && <span className="ml-2 text-xs text-slate-500">{p.period}</span>}
                </div>
                {p.techStack.length > 0 && (
                  <div className="mt-1">
                    <Tags items={p.techStack} />
                  </div>
                )}
                {p.description && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{p.description}</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {profile.workExperience.length > 0 && (
        <Section title={`工作经验（${profile.workExperience.length}）`}>
          <ul className="grid gap-2.5">
            {profile.workExperience.map((w, i) => (
              <li key={`${w.company}-${i}`}>
                <div className="text-slate-200">
                  {w.company}
                  {w.role && <span className="mx-1.5 text-slate-500">{w.role}</span>}
                  {w.period && <span className="text-xs text-slate-500">{w.period}</span>}
                </div>
                {w.summary && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">{w.summary}</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {profile.education.length > 0 && (
        <Section title="教育经历">
          <ul className="grid gap-1">
            {profile.education.map((e, i) => (
              <li key={`${e.school}-${i}`} className="text-slate-300">
                {[e.school, e.major, e.degree, e.period].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {profile.selfEvaluation && (
        <Section title="自我评价">
          <p className="text-xs leading-relaxed text-slate-400">{profile.selfEvaluation}</p>
        </Section>
      )}

      {profile.other.length > 0 && (
        <Section title="其他">
          <ul className="grid gap-1">
            {profile.other.map((o) => (
              <li key={o} className="text-xs text-slate-400">
                {o}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {profile.assessmentPoints.length > 0 && (
        <Section title={`本次面试将考察的要点（${profile.assessmentPoints.length}）`}>
          <ul className="grid gap-1.5">
            {profile.assessmentPoints.map((p) => (
              <li key={p} className="text-xs leading-relaxed text-slate-400">
                · {p}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

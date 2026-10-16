import type { ReactNode } from 'react';

/** 页面标题区。 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** 内容卡片。 */
export function Card({
  title,
  description,
  children,
  className = '',
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900/40 p-5 ${className}`}>
      {title && (
        <header className="mb-4">
          <h2 className="text-sm font-medium text-slate-200">{title}</h2>
          {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

/** 表单字段容器。 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 ' +
  'placeholder:text-slate-600 focus:border-slate-500 focus:outline-none disabled:opacity-50';

export const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export const buttonPrimary = `${buttonBase} bg-emerald-500 text-slate-950 hover:bg-emerald-400`;

export const buttonSecondary = `${buttonBase} border border-slate-700 text-slate-200 hover:bg-slate-800`;

/** 提示条。用于错误与成功反馈，不使用庆祝式视觉。 */
export function Notice({
  kind,
  children,
}: {
  kind: 'info' | 'success' | 'error' | 'warning';
  children: ReactNode;
}) {
  const styles = {
    info: 'border-slate-700 bg-slate-800/50 text-slate-300',
    success: 'border-emerald-900 bg-emerald-950/40 text-emerald-300',
    error: 'border-red-900 bg-red-950/40 text-red-300',
    warning: 'border-amber-900 bg-amber-950/40 text-amber-300',
  }[kind];

  return <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${styles}`}>{children}</div>;
}

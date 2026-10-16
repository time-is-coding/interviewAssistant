import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError, api } from '../api/client.ts';
import type { Resume } from '../api/types.ts';
import { Card, Notice, PageHeader, buttonPrimary, buttonSecondary } from '../components/Ui.tsx';
import ProfileView from '../components/ProfileView.tsx';

type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'parsing'; resume: Resume }
  | { phase: 'ready'; resume: Resume }
  | { phase: 'error'; message: string };

export default function Home() {
  const navigate = useNavigate();
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState<Resume[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const { resumes } = await api.listResumes();
      setHistory(resumes);
      setHistoryError(null);
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [loadHistory]);

  /** 轮询解析状态。后台解析是异步的，本地模型通常十秒内完成。 */
  const pollParse = useCallback((resumeId: string) => {
    const tick = async () => {
      try {
        const { resume } = await api.getResume(resumeId);
        if (resume.parseStatus === 'done') {
          setState({ phase: 'ready', resume });
          void loadHistory();
          return;
        }
        if (resume.parseStatus === 'failed') {
          setState({ phase: 'error', message: resume.parseError ?? '画像解析失败' });
          return;
        }
        setState({ phase: 'parsing', resume });
        timer.current = window.setTimeout(tick, 1500);
      } catch (err) {
        setState({ phase: 'error', message: err instanceof ApiError ? err.message : String(err) });
      }
    };
    void tick();
  }, [loadHistory]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        setState({ phase: 'error', message: '目前只支持 PDF 格式的简历' });
        return;
      }

      setState({ phase: 'uploading' });
      try {
        const { resume } = await api.uploadResume(file);
        setState({ phase: 'parsing', resume });
        pollParse(resume.id);
      } catch (err) {
        setState({ phase: 'error', message: err instanceof ApiError ? err.message : String(err) });
      }
    },
    [pollParse],
  );

  const busy = state.phase === 'uploading' || state.phase === 'parsing';

  return (
    <>
      <PageHeader
        title="AI 面试助手"
        description="上传简历，由大模型解析出画像，然后基于这份简历进行一场追问式的模拟面试。"
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid content-start gap-5">
          {/* 上传区 */}
          {(state.phase === 'idle' || state.phase === 'error') && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void handleFile(file);
              }}
              className={`rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
                dragging ? 'border-emerald-500 bg-emerald-950/20' : 'border-slate-800 bg-slate-900/30'
              }`}
            >
              <p className="text-sm text-slate-300">把简历 PDF 拖到这里</p>
              <p className="mt-1 text-xs text-slate-500">或</p>
              <button className={`${buttonPrimary} mt-3`} onClick={() => fileInput.current?.click()}>
                选择文件
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                  e.target.value = '';
                }}
              />
              <p className="mt-4 text-xs text-slate-600">
                只支持可复制文字的 PDF。扫描件无法提取文本。
              </p>
            </div>
          )}

          {state.phase === 'error' && (
            <Notice kind="error">
              {state.message}
              <button
                className="ml-3 underline underline-offset-2"
                onClick={() => setState({ phase: 'idle' })}
              >
                重新上传
              </button>
            </Notice>
          )}

          {busy && (
            <Card title={state.phase === 'uploading' ? '正在上传…' : '正在解析简历…'}>
              <div className="flex items-center gap-3">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                <span className="text-sm text-slate-400">
                  {state.phase === 'uploading'
                    ? '读取 PDF 文本'
                    : '调用大模型提取画像，本地模型通常需要十几秒'}
                </span>
              </div>
            </Card>
          )}

          {state.phase === 'ready' && (
            <>
              <Card
                title="简历画像"
                description={`${state.resume.filename} · 原文 ${state.resume.rawTextLength} 字`}
              >
                <ProfileView profile={state.resume.profile} />
              </Card>

              <div className="flex flex-wrap gap-3">
                <button
                  className={buttonPrimary}
                  onClick={() => navigate(`/setup/${state.resume.id}`)}
                >
                  用这份简历开始面试
                </button>
                <button
                  className={buttonSecondary}
                  onClick={() => setState({ phase: 'idle' })}
                >
                  换一份简历
                </button>
              </div>
            </>
          )}
        </div>

        {/* 历史 */}
        <Card title="历史简历" className="lg:sticky lg:top-20 lg:self-start">
          {historyError && <Notice kind="error">{historyError}</Notice>}
          {!historyError && history.length === 0 && (
            <p className="text-sm text-slate-500">还没有上传过简历。</p>
          )}
          <ul className="grid gap-2">
            {history.map((r) => (
              <li key={r.id}>
                <button
                  className="w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
                  onClick={() => {
                    if (r.parseStatus === 'done') {
                      setState({ phase: 'ready', resume: r });
                    } else if (r.parseStatus === 'failed') {
                      setState({ phase: 'error', message: r.parseError ?? '解析失败' });
                    } else {
                      setState({ phase: 'parsing', resume: r });
                      pollParse(r.id);
                    }
                  }}
                >
                  <span className="block truncate text-sm text-slate-200">{r.filename}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {r.parseStatus === 'done' && (r.profile?.targetRole || '已解析')}
                    {r.parseStatus === 'failed' && '解析失败'}
                    {r.parseStatus !== 'done' && r.parseStatus !== 'failed' && '解析中…'}
                    {' · '}
                    {new Date(r.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

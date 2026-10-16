import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ApiError, api, streamTurn } from '../api/client.ts';
import type { InterviewMessage, InterviewSession } from '../api/types.ts';
import { Notice, buttonPrimary, buttonSecondary } from '../components/Ui.tsx';
import { usePushToTalk } from '../hooks/usePushToTalk.ts';

export default function Interview() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState<InterviewSession | null>(null);
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finishedNotice, setFinishedNotice] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const usedVoiceRef = useRef(false);

  const isFinished = session?.status === 'finished';

  /** 语音识别到的文本追加进输入框，候选人可以先看一眼再发，识别错了能改。 */
  const handleVoiceCommit = useCallback((text: string) => {
    usedVoiceRef.current = true;
    setDraft((prev) => (prev ? `${prev}${text}` : text));
  }, []);

  const ptt = usePushToTalk({
    enabled: !isFinished && !busy,
    onCommit: handleVoiceCommit,
  });

  useEffect(() => {
    void (async () => {
      try {
        const { session: data } = await api.getSession(sessionId);
        setSession(data);
        setMessages(data.messages);
        if (data.status === 'finished') setFinishedNotice(true);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  // 新消息或流式内容变化时滚到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  async function handleSend() {
    const content = draft.trim();
    if (!content || busy || isFinished) return;

    const inputMode: 'voice' | 'keyboard' = usedVoiceRef.current ? 'voice' : 'keyboard';
    usedVoiceRef.current = false;

    setBusy(true);
    setError(null);
    setDraft('');
    setStreamingText('');

    // 乐观插入候选人消息，等 done 事件回来后补上服务端版本
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        seq: prev.length + 1,
        role: 'candidate',
        content,
        inputMode,
        createdAt: new Date().toISOString(),
      },
    ]);

    await streamTurn(sessionId, { content, inputMode }, {
      onDelta: (text) => setStreamingText((prev) => prev + text),
      onDone: (event) => {
        setStreamingText('');
        setMessages((prev) => [
          ...prev,
          {
            ...event.message,
            inputMode: null,
            createdAt: new Date().toISOString(),
          },
        ]);
        setSession((prev) =>
          prev
            ? {
                ...prev,
                roundCount: event.roundCount,
                status: event.ended ? 'finished' : 'running',
              }
            : prev,
        );
        if (event.ended) setFinishedNotice(true);
        setBusy(false);
      },
      onError: (message) => {
        setStreamingText('');
        setError(message);
        setBusy(false);
      },
    });
  }

  async function handleFinish() {
    if (!window.confirm('结束面试并生成评分报告？结束后无法继续作答。')) return;
    try {
      await api.finishSession(sessionId);
      navigate(`/report/${sessionId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  }

  if (loading) return <p className="text-sm text-slate-500">加载中…</p>;
  if (!session) return <Notice kind="error">{error ?? '会话不存在'}</Notice>;

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-4">
      {/* 状态栏 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
        <span className="text-sm text-slate-200">{session.personaName}</span>
        <span className="text-xs text-slate-500">L{session.difficulty} 难度</span>
        <span className="text-xs text-slate-500">
          第 {session.roundCount} / {session.maxRounds} 轮
        </span>
        {session.coverage.length > 0 && (
          <span className="text-xs text-slate-500">已覆盖 {session.coverage.length} 个考察点</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {!isFinished && (
            <button className={buttonSecondary} onClick={handleFinish}>
              结束面试并评分
            </button>
          )}
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {finishedNotice && (
        <Notice kind="info">
          面试已结束。
          <button
            className="ml-2 underline underline-offset-2"
            onClick={() => navigate(`/report/${sessionId}`)}
          >
            查看评分报告
          </button>
        </Notice>
      )}

      {/* 对话区 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/20 p-4"
      >
        <div className="grid gap-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {streamingText && (
            <MessageBubble
              message={{
                id: 'streaming',
                seq: 0,
                role: 'interviewer',
                content: streamingText,
                inputMode: null,
                createdAt: '',
              }}
              streaming
            />
          )}

          {busy && !streamingText && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              面试官正在思考…
            </div>
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        {ptt.error && (
          <div className="mb-2">
            <Notice kind="warning">
              {ptt.error}
              <button className="ml-2 underline underline-offset-2" onClick={ptt.clearError}>
                知道了
              </button>
            </Notice>
          </div>
        )}

        {ptt.listening && (
          <div className="mb-2 flex items-center gap-3 rounded-lg border border-emerald-900 bg-emerald-950/30 px-3 py-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="shrink-0 text-xs text-emerald-400">正在聆听</span>
            <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
              {ptt.committed}
              <span className="text-slate-500">{ptt.interim}</span>
            </span>
          </div>
        )}

        <textarea
          className="h-24 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none disabled:opacity-50"
          placeholder={
            isFinished
              ? '面试已结束'
              : '输入你的回答，或按住空格说话…（输入框内按空格就是普通空格）'
          }
          value={draft}
          disabled={isFinished}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={`${buttonPrimary} select-none`}
            disabled={isFinished || busy || !ptt.supported}
            onPointerDown={(e) => {
              e.preventDefault();
              ptt.pressStart();
            }}
            onPointerUp={ptt.pressEnd}
            onPointerLeave={ptt.pressEnd}
            onPointerCancel={ptt.pressEnd}
          >
            {ptt.listening ? '松开结束' : '按住说话'}
          </button>

          <button
            className={buttonSecondary}
            onClick={handleSend}
            disabled={isFinished || busy || !draft.trim()}
          >
            {busy ? '等待面试官…' : '发送'}
          </button>

          <span className="text-xs text-slate-600">
            {ptt.supported ? (
              <>
                按住 <kbd className="rounded border border-slate-700 px-1">空格</kbd> 说话，松开结束
                {ptt.listening && '，Esc 取消'}
                <span className="mx-2 text-slate-700">|</span>
                <kbd className="rounded border border-slate-700 px-1">Ctrl</kbd>+
                <kbd className="rounded border border-slate-700 px-1">Enter</kbd> 发送
              </>
            ) : (
              '当前浏览器不支持语音输入，请使用 Chrome 或 Edge。可以继续用键盘作答。'
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  streaming = false,
}: {
  message: InterviewMessage;
  streaming?: boolean;
}) {
  const isInterviewer = message.role === 'interviewer';

  return (
    <div className={`flex ${isInterviewer ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[85%] ${isInterviewer ? '' : 'text-right'}`}>
        <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
          {isInterviewer ? (
            <span>面试官</span>
          ) : (
            <>
              {message.inputMode === 'voice' && (
                <span className="rounded border border-slate-700 px-1.5 py-px text-[10px]">
                  语音
                </span>
              )}
              <span>我</span>
            </>
          )}
        </div>
        <div
          className={`whitespace-pre-wrap rounded-xl px-4 py-2.5 text-left text-sm leading-relaxed ${
            isInterviewer
              ? 'border border-slate-800 bg-slate-900/60 text-slate-200'
              : 'bg-emerald-950/40 text-slate-100'
          }`}
        >
          {message.content}
          {streaming && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-emerald-400 align-middle" />
          )}
        </div>
      </div>
    </div>
  );
}

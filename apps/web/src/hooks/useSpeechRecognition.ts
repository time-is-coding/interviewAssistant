import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Web Speech API 封装，面向「按住说话」场景。
 *
 * 用法：begin() 开始识别，end() 结束并把整段文本回调出去，cancel() 丢弃。
 * 中途的识别结果通过 interim / committed 暴露，供界面实时呈现。
 *
 * 这里处理的坑（都在实测中遇到过或被广泛报告）：
 * - Chrome 静音超时会自行结束识别，用户仍按住时需要自动重启，否则长句被截断；
 * - stop() 之后实例不可复用，每次重新开始都要新建实例；
 * - 结果分 final 与 interim 两类，final 才是稳定的，interim 会不断被改写。
 */

// 标准名与 Chrome 前缀名并存；Firefox 两个都没有。
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string } | undefined;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike | undefined };
}

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Chrome 静音自动结束后的重启上限，防止无限循环。 */
const MAX_AUTO_RESTARTS = 3;

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝。请点击地址栏的权限图标允许使用麦克风后重试。',
  'service-not-allowed': '浏览器拒绝了语音识别服务。请检查浏览器权限设置。',
  network: '语音识别需要联网（Chrome 会把音频送到云端识别）。请检查网络连接。',
};

export interface SpeechRecognitionApi {
  supported: boolean;
  listening: boolean;
  /** 本次按住期间已确认的文本 */
  committed: string;
  /** 尚未确认的实时识别文本 */
  interim: string;
  error: string | null;
  begin: () => void;
  end: () => void;
  cancel: () => void;
  clearError: () => void;
}

export function useSpeechRecognition(
  lang = 'zh-CN',
  onCommit?: (text: string) => void,
): SpeechRecognitionApi {
  const [supported] = useState(() => getCtor() !== null);
  const [listening, setListening] = useState(false);
  const [committed, setCommitted] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  /** 用户是否仍处于「按住」状态。识别自己结束时据此决定要不要重启。 */
  const holdingRef = useRef(false);
  const cancelledRef = useRef(false);
  const restartsRef = useRef(0);
  const committedRef = useRef('');
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  /** 收尾：停掉识别、把累计文本交出去。 */
  const settle = useCallback(() => {
    holdingRef.current = false;
    recognitionRef.current = null;
    setListening(false);
    setInterim('');

    const text = committedRef.current.trim();
    committedRef.current = '';
    setCommitted('');

    if (!cancelledRef.current && text) onCommitRef.current?.(text);
  }, []);

  /** 建一个新的识别实例并启动。stop() 过的实例不能复用，所以每次都要新建。 */
  const startRecognition = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          committedRef.current += text;
          setCommitted(committedRef.current);
        } else {
          pending += text;
        }
      }
      setInterim(pending);
    };

    recognition.onerror = (event) => {
      // 这两个不是用户需要处理的错误：aborted 是我们主动取消，no-speech 是没听到人声
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') {
        setError('没有识别到语音，请靠近麦克风再说一次。');
        return;
      }
      setError(ERROR_MESSAGES[event.error] ?? `语音识别出错：${event.error}`);
    };

    recognition.onend = () => {
      // 用户还按着，但浏览器自己结束了——多半是静音超时。重启继续听。
      if (holdingRef.current && restartsRef.current < MAX_AUTO_RESTARTS) {
        restartsRef.current += 1;
        startRecognition();
        return;
      }
      settle();
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // 连续 start() 会抛 InvalidStateError，忽略即可——上一轮的结果仍在收尾
      settle();
    }
  }, [lang, settle]);

  const begin = useCallback(() => {
    if (!supported) return;
    cancelledRef.current = false;
    committedRef.current = '';
    restartsRef.current = 0;
    holdingRef.current = true;
    setCommitted('');
    setInterim('');
    setError(null);
    setListening(true);
    startRecognition();
  }, [supported, startRecognition]);

  /** 结束并提交。用 stop() 而非 abort()，这样最后一段能作为 final 结果返回。 */
  const end = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    const recognition = recognitionRef.current;
    if (recognition) recognition.stop();
    else settle();
  }, [settle]);

  /** 取消并丢弃本次内容。 */
  const cancel = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    cancelledRef.current = true;
    const recognition = recognitionRef.current;
    if (recognition) recognition.abort();
    else settle();
  }, [settle]);

  // 组件卸载时收尾，避免识别在后台继续跑
  useEffect(
    () => () => {
      holdingRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  return {
    supported,
    listening,
    committed,
    interim,
    error,
    begin,
    end,
    cancel,
    clearError: useCallback(() => setError(null), []),
  };
}

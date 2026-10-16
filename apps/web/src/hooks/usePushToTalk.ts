import { useCallback, useEffect, useRef } from 'react';

import { useSpeechRecognition, type SpeechRecognitionApi } from './useSpeechRecognition.ts';

export interface PushToTalkApi extends SpeechRecognitionApi {
  /** 供界面按钮的 pointerdown 使用 */
  pressStart: () => void;
  /** 供界面按钮的 pointerup / pointerleave / pointercancel 使用 */
  pressEnd: () => void;
}

/**
 * 按住说话。
 *
 * 键盘：按住空格开始，松开结束；按住期间按 Esc 取消本次。
 * 按钮：按住（鼠标/触屏）开始，松开结束。
 *
 * 必须处理的边界：
 * 1. 系统长按重复 —— keydown 会以 repeat=true 反复触发，不拦住会把识别反复重启。
 * 2. 输入法组字 —— 中文输入法里的空格也会触发 keydown，此时不能抢。
 * 3. 输入框内不劫持 —— 候选人在输入框打字时，空格就是空格。
 * 4. 页面滚动 —— 空格默认会滚动页面，只在真正开始录音时 preventDefault。
 * 5. 失焦 —— 按住时切窗口/切标签页收不到 keyup，会一直录音，需要 blur/visibilitychange 兜底。
 */
export function usePushToTalk(options: {
  enabled: boolean;
  onCommit: (text: string) => void;
}): PushToTalkApi {
  const { enabled } = options;

  const onCommitRef = useRef(options.onCommit);
  onCommitRef.current = options.onCommit;

  const speech = useSpeechRecognition('zh-CN', (text) => onCommitRef.current(text));
  const { supported, begin, end, cancel } = speech;

  const holdingRef = useRef(false);

  const stop = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    end();
  }, [end]);

  const start = useCallback(() => {
    if (holdingRef.current) return;
    holdingRef.current = true;
    begin();
  }, [begin]);

  const abort = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    cancel();
  }, [cancel]);

  useEffect(() => {
    if (!enabled || !supported) return;

    /** 焦点在输入框/可编辑区域时，空格交给它们自己处理。 */
    const isEditableFocused = (): boolean => {
      const el = document.activeElement;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable === true
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // 按住期间按 Esc 取消本次识别，不提交已识别的内容
      if (event.key === 'Escape') {
        abort();
        return;
      }

      if (event.code !== 'Space') return;
      if (event.repeat) return; // 系统长按重复
      if (event.isComposing) return; // 输入法组字中
      if (isEditableFocused()) return; // 输入框里空格就是空格
      if (holdingRef.current) return;

      event.preventDefault(); // 阻止空格滚动页面
      start();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      if (!holdingRef.current) return;
      stop();
    };

    /** 切窗口 / 切标签页 / 浏览器失去焦点时收不到 keyup，必须强制收尾。 */
    const onInterrupt = () => stop();

    const onVisibilityChange = () => {
      if (document.hidden) stop();
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onInterrupt);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onInterrupt);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // 关闭开关时（例如面试已结束）也要收尾，别让识别在后台继续
      if (holdingRef.current) {
        holdingRef.current = false;
        cancel();
      }
    };
  }, [enabled, supported, start, stop, abort, cancel]);

  return {
    ...speech,
    pressStart: start,
    pressEnd: stop,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import "./message-scrollbar.css";

type MessageScrollbarProps = {
  containerRef: React.RefObject<HTMLElement | null>;
  contentVersion: number | string;
};

function viewportOf(root: HTMLElement | null): HTMLElement | null {
  if (root == null) {
    return null;
  }
  return (
    root.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']") ?? root
  );
}

/**
 * 聊天室 / 私聊自定义滚动条：上跳到最早、下跳到最新、拖滑块。
 * 对齐旧版 scrollbar.vue。内容未溢出时隐藏。
 */
export function MessageScrollbar({
  containerRef,
  contentVersion,
}: MessageScrollbarProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const maxRef = useRef(0);
  const [metrics, setMetrics] = useState({
    scrollTop: 0,
    max: 0,
  });

  const measure = useCallback(() => {
    const root = viewportOf(containerRef.current);
    if (root == null) {
      return;
    }
    const max = Math.max(0, root.scrollHeight - root.clientHeight);
    maxRef.current = max;
    setMetrics({ scrollTop: root.scrollTop, max });
  }, [containerRef]);

  useEffect(() => {
    measure();
    const root = viewportOf(containerRef.current);
    if (root == null) {
      return;
    }
    const onScroll = (): void => measure();
    root.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    if (root.firstElementChild) {
      observer.observe(root.firstElementChild);
    }
    return () => {
      root.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [containerRef, contentVersion, measure]);

  useEffect(() => {
    function onMove(event: MouseEvent): void {
      if (!dragging.current) {
        return;
      }
      jumpByClientY(event.clientY);
    }
    function onUp(): void {
      dragging.current = false;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, []);

  function jumpTo(top: number): void {
    const root = viewportOf(containerRef.current);
    if (root == null) {
      return;
    }
    root.scrollTop = top;
    measure();
  }

  function jumpByClientY(clientY: number): void {
    const bar = barRef.current;
    const root = viewportOf(containerRef.current);
    const max = maxRef.current;
    if (bar == null || root == null || max <= 0) {
      return;
    }
    const rect = bar.getBoundingClientRect();
    if (rect.height <= 0) {
      return;
    }
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    jumpTo(ratio * max);
  }

  if (metrics.max < 20) {
    return null;
  }

  const thumb = `${(metrics.scrollTop / metrics.max) * 100}%`;

  return (
    <div className="msg-scrollbar" aria-hidden="true">
      <button
        type="button"
        className="msg-scrollbar__btn"
        title="跳到最早"
        onMouseDown={(event) => {
          event.preventDefault();
          jumpTo(0);
        }}
      >
        ▲
      </button>
      <div
        ref={barRef}
        className="msg-scrollbar__track"
        onMouseDown={(event) => {
          event.preventDefault();
          jumpByClientY(event.clientY);
        }}
      >
        <button
          type="button"
          className="msg-scrollbar__thumb"
          style={{ top: thumb }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dragging.current = true;
          }}
        />
      </div>
      <button
        type="button"
        className="msg-scrollbar__btn msg-scrollbar__btn--down"
        title="跳到最新"
        onMouseDown={(event) => {
          event.preventDefault();
          jumpTo(metrics.max);
        }}
      >
        ▼
      </button>
    </div>
  );
}

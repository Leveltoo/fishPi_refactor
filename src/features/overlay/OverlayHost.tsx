import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

import { copyImageFromSrc } from "../chatroom/userMenuActions";
import { sanitizeHttpUrl } from "../../lib/markdown";
import {
  parsePreviewImage,
  parseUserCard,
  PREVIEW_IMAGE_EVENT,
  USER_CARD_EVENT,
  type PreviewImageDetail,
} from "./events";
import { useUserCardHover } from "../usercard/hover";
import { showUserCardWindow } from "../usercard/window";
import { fitImageLayout, zoomImageLayout, type ImageLayout } from "./imageLayout";
import "./overlay.css";

/**
 * 主窗 overlay 宿主：
 * 1. 看图 Dialog（滚轮缩放、拖拽、系统浏览器打开、右键复制、Esc 关闭）
 * 2. 用户名片统一走 `user-card` 子窗口（悬停/点击由 usercard/hover 驱动）
 */
export function OverlayHost() {
  const [image, setImage] = useState<PreviewImageDetail | null>(null);

  useUserCardHover();

  useEffect(() => {
    function onImage(event: Event) {
      const next = parsePreviewImage(event);
      if (!next) {
        return;
      }
      setImage(next);
    }

    function onCard(event: Event) {
      const next = parseUserCard(event);
      if (!next) {
        return;
      }
      setImage(null);
      const detail = (event as CustomEvent).detail as
        | { x?: number; y?: number }
        | string
        | undefined;
      const x =
        detail && typeof detail === "object" && typeof detail.x === "number"
          ? detail.x
          : undefined;
      const y =
        detail && typeof detail === "object" && typeof detail.y === "number"
          ? detail.y
          : undefined;
      void showUserCardWindow(next, x, y).catch(() => toast.error("打开名片失败"));
    }

    window.addEventListener(PREVIEW_IMAGE_EVENT, onImage);
    window.addEventListener(USER_CARD_EVENT, onCard);
    return () => {
      window.removeEventListener(PREVIEW_IMAGE_EVENT, onImage);
      window.removeEventListener(USER_CARD_EVENT, onCard);
    };
  }, []);

  return (
    <ImagePreviewDialog
      image={image}
      onClose={() => {
        setImage(null);
      }}
    />
  );
}

function ImagePreviewDialog({
  image,
  onClose,
}: {
  image: PreviewImageDetail | null;
  onClose: () => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const layoutRef = useRef<ImageLayout>({ width: 0, height: 0, x: 0, y: 0 });
  const dragRef = useRef<{
    pointer: { x: number; y: number };
    start: ImageLayout;
  } | null>(null);
  const [layout, setLayout] = useState<ImageLayout>({
    width: 0,
    height: 0,
    x: 0,
    y: 0,
  });
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);

  const src = image ? (sanitizeHttpUrl(image.src) ?? image.src) : "";
  const title = imageName(image);

  function commit(next: ImageLayout): void {
    layoutRef.current = next;
    setLayout(next);
  }

  function fitImage(): void {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (stage == null || img == null || img.naturalWidth === 0) {
      return;
    }
    commit(fitImageLayout(
      img.naturalWidth, img.naturalHeight, stage.clientWidth, stage.clientHeight,
    ));
  }

  useEffect(() => {
    layoutRef.current = { width: 0, height: 0, x: 0, y: 0 };
    setLayout({ width: 0, height: 0, x: 0, y: 0 });
    dragRef.current = null;
    setDragging(false);
    setFailed(false);
  }, [src]);

  useEffect(() => {
    if (image == null) {
      return;
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [image, onClose]);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage == null || image == null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      fitImage();
    });
    observer.observe(stage);
    const host = stage;
    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      const current = layoutRef.current;
      if (current.width <= 0 || current.height <= 0) {
        return;
      }
      const rect = host.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      commit(zoomImageLayout(current, event.deltaY, cx, cy));
    }
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      host.removeEventListener("wheel", onWheel);
    };
  }, [image]);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    function onMove(event: MouseEvent): void {
      const drag = dragRef.current;
      if (drag == null) {
        return;
      }
      commit({
        width: drag.start.width,
        height: drag.start.height,
        x: drag.start.x + (event.clientX - drag.pointer.x),
        y: drag.start.y + (event.clientY - drag.pointer.y),
      });
    }
    function onUp(): void {
      dragRef.current = null;
      setDragging(false);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  function onDragStart(event: ReactMouseEvent<HTMLImageElement>): void {
    event.preventDefault();
    if (layoutRef.current.width <= 0) {
      return;
    }
    dragRef.current = {
      pointer: { x: event.clientX, y: event.clientY },
      start: { ...layoutRef.current },
    };
    setDragging(true);
  }

  function openInBrowser(): void {
    const href = sanitizeHttpUrl(src);
    if (href == null) {
      return;
    }
    void openUrl(href).catch(() => toast.error("打开图片失败"));
  }

  return (
    <Dialog
      open={image != null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        className="dark ov-image-dialog max-w-[min(52rem,calc(100vw-2rem))] sm:max-w-[min(52rem,calc(100vw-2rem))]"
        showCloseButton
      >
        <DialogHeader className="ov-image-header">
          <DialogTitle className="ov-image-title" title={title}>{title || "图片预览"}</DialogTitle>
          <DialogDescription className="sr-only">
            滚轮缩放，拖拽移动，Esc 关闭
          </DialogDescription>
          {image ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title="适合窗口"
              aria-label="适合窗口"
              onClick={fitImage}
            >
              <RotateCcw />
            </Button>
          ) : null}
          {image ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="ov-image-open"
              onClick={openInBrowser}
            >
              用浏览器打开
            </Button>
          ) : null}
        </DialogHeader>
        {image ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                ref={stageRef}
                className={`ov-image-stage${dragging ? " is-dragging" : ""}`}
              >
                <img
                  key={src}
                  ref={imgRef}
                  src={src}
                  alt={image.alt ?? ""}
                  draggable={false}
                  className="ov-image-canvas"
                  onLoad={() => { setFailed(false); fitImage(); }}
                  onError={() => setFailed(true)}
                  onMouseDown={onDragStart}
                  onDoubleClick={fitImage}
                  style={{
                    visibility: failed ? "hidden" : undefined,
                    width: layout.width ? `${layout.width}px` : "auto",
                    height: layout.height ? `${layout.height}px` : "auto",
                    left: layout.width ? `${layout.x}px` : "50%",
                    top: layout.height ? `${layout.y}px` : "50%",
                  }}
                />
                {failed ? <p className="ov-image-error" role="alert">图片加载失败</p> : null}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => {
                  void copyImageFromSrc(src, imgRef.current)
                    .catch(() => toast.error("复制图片失败"));
                }}
              >
                复制图片
              </ContextMenuItem>
              <ContextMenuItem onSelect={openInBrowser}>
                用浏览器打开
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function imageName(image: PreviewImageDetail | null): string {
  if (image == null) {
    return "";
  }
  if (image.alt?.trim()) {
    return image.alt.trim();
  }
  try {
    const path = new URL(image.src).pathname;
    const base = path.split("/").pop() ?? "";
    return decodeURIComponent(base) || "图片预览";
  } catch {
    return "图片预览";
  }
}

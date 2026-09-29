import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

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
import "./overlay.css";

/**
 * 主窗 overlay 宿主：
 * 1. 看图 Dialog（滚轮缩放、拖拽、系统浏览器打开、右键复制、Esc 关闭）
 * 2. 用户名片统一走 `user-card` 子窗口（悬停/点击由 usercard/hover 驱动）
 */
export function OverlayHost() {
  const [image, setImage] = useState<PreviewImageDetail | null>(null);
  const gen = useRef(0);

  useUserCardHover();

  useEffect(() => {
    function onImage(event: Event) {
      const next = parsePreviewImage(event);
      if (!next) {
        return;
      }
      gen.current += 1;
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
      void showUserCardWindow(next, x, y);
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

type ImageLayout = {
  width: number;
  height: number;
  x: number;
  y: number;
};

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
    const content = {
      width: stage.clientWidth,
      height: stage.clientHeight,
    };
    const ratio = img.naturalHeight / img.naturalWidth;
    const width = ratio <= 1 ? content.width : content.height / ratio;
    const height = ratio > 1 ? content.height : content.width * ratio;
    commit({
      width,
      height,
      x: (content.width - width) / 2,
      y: (content.height - height) / 2,
    });
  }

  useEffect(() => {
    layoutRef.current = { width: 0, height: 0, x: 0, y: 0 };
    setLayout({ width: 0, height: 0, x: 0, y: 0 });
    dragRef.current = null;
    setDragging(false);
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
      if (layoutRef.current.width <= 0) {
        fitImage();
      }
    });
    observer.observe(stage);
    const host = stage;
    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      const current = layoutRef.current;
      if (current.width <= 0 || current.height <= 0) {
        return;
      }
      if (event.deltaY > 0 && (current.width < 20 || current.height < 20)) {
        return;
      }
      const ratio = current.height / current.width;
      const width = Math.max(20, current.width - event.deltaY);
      const height = width * ratio;
      const rect = host.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      commit({
        width,
        height,
        x: cx - ((cx - current.x) / current.width) * width,
        y: cy - ((cy - current.y) / current.height) * height,
      });
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
    void openUrl(href);
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
          <DialogTitle title={title}>{title || "图片预览"}</DialogTitle>
          <DialogDescription className="sr-only">
            滚轮缩放，拖拽移动，Esc 关闭
          </DialogDescription>
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
                  ref={imgRef}
                  src={src}
                  alt={image.alt ?? ""}
                  draggable={false}
                  className="ov-image-canvas"
                  onLoad={fitImage}
                  onMouseDown={onDragStart}
                  style={{
                    width: layout.width ? `${layout.width}px` : "auto",
                    height: layout.height ? `${layout.height}px` : "auto",
                    left: layout.width ? `${layout.x}px` : "50%",
                    top: layout.height ? `${layout.y}px` : "50%",
                  }}
                />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => {
                  void copyImageFromSrc(src, imgRef.current);
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

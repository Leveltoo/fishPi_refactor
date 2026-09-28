import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
 * 1. 看图 Dialog
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

function ImagePreviewDialog({
  image,
  onClose,
}: {
  image: PreviewImageDetail | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={image != null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent className="dark ov-image-dialog" showCloseButton>
        <DialogHeader className="ov-image-header">
          <DialogTitle>{image?.alt?.trim() || "图片预览"}</DialogTitle>
          <DialogDescription className="sr-only">
            仅展示 http(s) 外链图片
          </DialogDescription>
        </DialogHeader>
        {image ? (
          <img src={sanitizeHttpUrl(image.src) ?? image.src} alt={image.alt ?? ""} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
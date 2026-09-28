import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export type WarnBroadcast = {
  text: string;
  publisher: string;
};

type WarnBroadcastDialogProps = {
  broadcast: WarnBroadcast | null;
  onClose: () => void;
};

export function WarnBroadcastDialog({
  broadcast,
  onClose,
}: WarnBroadcastDialogProps) {
  useEffect(() => {
    if (!broadcast) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [broadcast, onClose]);

  if (!broadcast) {
    return null;
  }

  return (
    <div
      className="shell-broadcast"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="shell-broadcast__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shell-broadcast-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="shell-broadcast-title" className="shell-broadcast__title">
          摸鱼派社区紧急公告
        </h2>
        <p className="shell-broadcast__body">{broadcast.text}</p>
        {broadcast.publisher ? (
          <p className="shell-broadcast__who">———— {broadcast.publisher}</p>
        ) : null}
        <Button type="button" onClick={onClose}>
          已阅
        </Button>
      </div>
    </div>
  );
}

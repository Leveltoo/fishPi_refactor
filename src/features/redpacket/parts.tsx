import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { sanitizeHttpUrl } from "../../lib/markdown";
import { GESTURES, gestureLabel } from "./constants";
import type { GestureIndex } from "./types";

export function GesturePicker({
  value,
  onChange,
  caption,
  disabled = false,
}: {
  value?: GestureIndex;
  onChange: (gesture: GestureIndex) => void;
  caption?: string;
  disabled?: boolean;
}) {
  return (
    <div className="rp-gestures">
      {caption ? <p className="rp-hint">{caption}</p> : null}
      <div className="rp-gesture-row">
        {GESTURES.map((item) => (
          <button
            key={item.value}
            type="button"
            className={value === item.value ? "rp-gesture is-active" : "rp-gesture"}
            disabled={disabled}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {value !== undefined ? (
        <p className="rp-meta">已选 {gestureLabel(value)}</p>
      ) : null}
    </div>
  );
}

export function SenderFace({
  name,
  src,
  size = "default",
}: {
  name: string;
  src: string;
  size?: "default" | "sm";
}) {
  const safe = sanitizeHttpUrl(src);
  const letter = name.trim().slice(0, 1) || "?";
  return (
    <Avatar size={size} className="rp-avatar">
      {safe ? <AvatarImage src={safe} alt="" /> : null}
      <AvatarFallback>{letter}</AvatarFallback>
    </Avatar>
  );
}

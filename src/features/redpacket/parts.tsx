import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { sanitizeHttpUrl } from "../../lib/markdown";
import { GESTURES } from "./constants";
import type { GestureIndex } from "./types";
import rock from "./assets/Rock.png";
import scissors from "./assets/Scissors.png";
import paper from "./assets/Paper.png";

const GESTURE_IMAGES = [rock, scissors, paper];

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
          <Button
            key={item.value}
            type="button"
            variant="ghost"
            size="icon-lg"
            className={value === item.value ? "rp-gesture is-active" : "rp-gesture"}
            disabled={disabled}
            title={item.label}
            aria-label={item.label}
            aria-pressed={value === item.value}
            onClick={() => onChange(item.value)}
          >
            <img src={GESTURE_IMAGES[item.value]} alt="" />
          </Button>
        ))}
      </div>
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

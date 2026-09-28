import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { sanitizeHttpUrl } from "../../../lib/markdown";

type PeerAvatarProps = {
  name: string;
  src?: string;
  size?: "default" | "sm";
};

export function PeerAvatar({ name, src, size = "default" }: PeerAvatarProps) {
  const href = sanitizeHttpUrl(src);
  const letter = name.trim().slice(0, 1) || "?";

  return (
    <Avatar size={size} className="im-avatar">
      {href ? <AvatarImage src={href} alt="" /> : null}
      <AvatarFallback>{letter}</AvatarFallback>
    </Avatar>
  );
}

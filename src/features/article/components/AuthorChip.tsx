import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { sanitizeHttpUrl } from "../../../lib/markdown";
import { dispatchUserCard } from "../events";

type AuthorChipProps = {
  userName: string;
  displayName: string;
  avatarUrl: string;
  size?: "default" | "sm";
  showName?: boolean;
};

export function AuthorChip({
  userName,
  displayName,
  avatarUrl,
  size = "sm",
  showName = true,
}: AuthorChipProps) {
  const href = sanitizeHttpUrl(avatarUrl);
  const label = displayName.trim() || userName.trim() || "?";
  const letter = label.slice(0, 1);

  return (
    <button
      type="button"
      className="article-author"
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        dispatchUserCard(userName || displayName);
      }}
    >
      <Avatar size={size} className="article-avatar">
        {href ? <AvatarImage src={href} alt="" /> : null}
        <AvatarFallback>{letter}</AvatarFallback>
      </Avatar>
      {showName ? <span className="article-author-name">{label}</span> : null}
    </button>
  );
}

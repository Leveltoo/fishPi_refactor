import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import { sanitizeHttpUrl } from "../../lib/markdown";
import { searchUsers, type UserSearchHit } from "./api";
import { dispatchUserCard } from "./events";
import "./overlay.css";

const SEARCH_DEBOUNCE_MS = 280;

type MentionListProps = {
  query: string;
  onPick: (userName: string) => void;
  onClose: () => void;
};

/**
 * Composer `@` 补全。捕获方向键 / 无修饰键 Enter / Esc，发送组合键留给输入框。
 */
export function MentionList({ query, onPick, onClose }: MentionListProps) {
  const [users, setUsers] = useState<UserSearchHit[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const needle = query.trim();
    if (needle.length === 0) {
      setUsers([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchUsers(needle).then((outcome) => {
        if (cancelled) {
          return;
        }
        if (outcome.status === "ok") {
          setUsers(outcome.users);
          setSelected(0);
          return;
        }
        setUsers([]);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setSelected((current) => nextIndex(current, users.length, 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setSelected((current) => nextIndex(current, users.length, -1));
        return;
      }
      if (
        event.key === "Enter" &&
        !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        const hit = users[selected];
        if (hit) {
          onPick(hit.userName);
        }
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose, onPick, selected, users]);

  const selectedName = users[selected]?.userName ?? "";
  if (users.length === 0) {
    return null;
  }

  return (
    <Command
      shouldFilter={false}
      value={selectedName}
      className="ov-mention h-auto max-h-64 w-80"
      aria-label="@ 用户补全"
    >
      <CommandList>
        {users.map((user) => (
          <CommandItem
            key={user.userName}
            value={user.userName}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onSelect={() => {
              onPick(user.userName);
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ov-mention-face"
              aria-label={`查看 ${user.userName} 的名片`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                dispatchUserCard(user.userName);
              }}
            >
              <UserFace user={user} />
            </Button>
            <span>{user.userName}</span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

function UserFace({ user }: { user: UserSearchHit }) {
  const href = sanitizeHttpUrl(user.userAvatarUrl);
  const letter = user.userName.trim().slice(0, 1) || "?";
  return (
    <Avatar size="sm">
      {href ? <AvatarImage src={href} alt="" /> : null}
      <AvatarFallback>{letter}</AvatarFallback>
    </Avatar>
  );
}

function nextIndex(current: number, length: number, delta: number): number {
  if (length <= 0) {
    return 0;
  }
  return (current + delta + length) % length;
}

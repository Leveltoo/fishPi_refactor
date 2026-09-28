import { useEffect, useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import { sanitizeHttpUrl } from "../../../lib/markdown";
import { SEARCH_DEBOUNCE_MS } from "../constants";
import { filterConversations } from "../conversation";
import type { Conversation, UserSearchHit } from "../types";

type StartChatDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversations: Conversation[];
  searchAvailable: boolean;
  onSearch: (query: string) => Promise<UserSearchHit[]>;
  onPick: (user: UserSearchHit) => void;
};

export function StartChatDialog({
  open,
  onOpenChange,
  conversations,
  searchAvailable,
  onSearch,
  onPick,
}: StartChatDialogProps) {
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<UserSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setRemote([]);
      setSearching(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const needle = query.trim();
    if (needle.length === 0) {
      setRemote([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void onSearch(needle).then((hits) => {
        if (!cancelled) {
          setRemote(hits);
          setSearching(false);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, onSearch, query]);

  const localHits = useMemo(
    () =>
      filterConversations(conversations, query).map((item) => ({
        userName: item.peerUserName,
        userAvatarUrl: item.peerAvatarUrl,
      })),
    [conversations, query],
  );

  const hits = mergeHits(localHits, remote);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="开始新私聊"
      description={
        searchAvailable
          ? "搜索用户并开始私聊"
          : "搜人暂不可用，仅可从已有会话过滤"
      }
      className="dark im-start-dialog"
    >
      <Command shouldFilter={false} className="im-start">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="想和谁聊聊？"
        />
        <CommandList>
          <CommandEmpty>
            {searching
              ? "正在搜索…"
              : searchAvailable
                ? "没有匹配的用户"
                : "没有匹配的会话"}
          </CommandEmpty>
          {hits.length > 0 ? (
            <CommandGroup
              heading={
                remote.length > 0 ? "用户" : "已有会话（本地过滤）"
              }
            >
              {hits.map((user) => (
                <CommandItem
                  key={user.userName}
                  value={user.userName}
                  onSelect={() => onPick(user)}
                >
                  <UserRow user={user} />
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function UserRow({ user }: { user: UserSearchHit }) {
  const href = sanitizeHttpUrl(user.userAvatarUrl);
  const letter = user.userName.trim().slice(0, 1) || "?";
  return (
    <>
      <Avatar size="sm">
        {href ? <AvatarImage src={href} alt="" /> : null}
        <AvatarFallback>{letter}</AvatarFallback>
      </Avatar>
      <span>{user.userName}</span>
    </>
  );
}

function mergeHits(local: UserSearchHit[], remote: UserSearchHit[]): UserSearchHit[] {
  const seen = new Set<string>();
  const result: UserSearchHit[] = [];
  for (const item of [...remote, ...local]) {
    const key = item.userName.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

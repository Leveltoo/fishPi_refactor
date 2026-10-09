import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sanitizeHttpUrl } from "../../../lib/markdown";
import {
  addEmojiUrl,
  loadEmojiGroupItems,
  loadEmojiGroups,
  loadRecentEmoji,
  rememberRecentEmoji,
  removeEmoji,
  type EmojiGroup,
  type EmojiItem,
  type RecentEmoji,
} from "../chatroomApi";
import { DEFAULT_EMOJIS } from "../defaultEmojis";
import { downloadEmojiJson, parseEmojiImport } from "../emojiImportExport";
import { isOutcomeUnknown, toUserErrorMessage } from "../toUserError";
import { isImageFile, uploadFiles } from "../../../lib/upload";
import { CloudEmojiFavorites } from "./CloudEmojiFavorites";

type EmojiPanelProps = {
  disabled: boolean;
  onInsert: (token: string) => void;
};
type Tab = "default" | "favorites" | "server" | "recent";

function imageToken(url: string): string {
  return `![图片表情](<${url}>)`;
}

export function EmojiPanel({ disabled, onInsert }: EmojiPanelProps) {
  const [tab, setTab] = useState<Tab>("default");
  const [recent, setRecent] = useState<RecentEmoji[]>([]);
  const [groups, setGroups] = useState<EmojiGroup[]>([]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [items, setItems] = useState<EmojiItem[]>([]);
  const [urlDraft, setUrlDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const faceInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRecentEmoji().then((list) => {
      if (!cancelled) setRecent(list);
    }).catch(() => {
      if (!cancelled) setRecent([]);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (tab !== "server") return;
    let cancelled = false;
    setError(null);
    void loadEmojiGroups().then((list) => {
      if (cancelled) return;
      setGroups(list);
      setGroupId((current) => list.some((group) => group.id === current) ? current : list[0]?.id ?? null);
    }).catch((err: unknown) => {
      if (!cancelled) {
        setGroups([]);
        setError(toUserErrorMessage(err));
      }
    });
    return () => { cancelled = true; };
  }, [tab]);

  useEffect(() => {
    if (tab !== "server") return;
    setItems([]);
    if (groupId == null) return;
    let cancelled = false;
    void loadEmojiGroupItems(groupId).then((list) => {
      if (!cancelled) setItems(list);
    }).catch((err: unknown) => {
      if (!cancelled) setError(toUserErrorMessage(err));
    });
    return () => { cancelled = true; };
  }, [tab, groupId]);

  async function remember(item: RecentEmoji, token: string): Promise<void> {
    onInsert(token);
    try {
      setRecent(await rememberRecentEmoji(item));
    } catch {
      // Local recents are optional and never represent cloud favorites.
    }
  }

  function beginWrite(): boolean {
    if (disabled || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    return true;
  }

  function endWrite(): void {
    busyRef.current = false;
    setBusy(false);
  }

  async function syncUrls(urls: string[], action: string): Promise<void> {
    const existing = new Set(items.map((item) => item.url));
    let ok = 0;
    let fail = 0;
    for (const url of urls) {
      if (existing.has(url)) continue;
      try {
        await addEmojiUrl(url, groupId ?? undefined);
        existing.add(url);
        ok += 1;
      } catch (err) {
        fail += 1;
        if (isOutcomeUnknown(err)) {
          setNotice("服务器表情写入结果待确认，请刷新列表，不要重复提交。");
          throw err;
        }
      }
    }
    const summary = `成功${action} ${ok} 条，失败 ${fail} 条`;
    setNotice(summary);
    if (fail > 0) toast.warning(summary);
    else toast.success(summary);
    if (groupId != null) setItems(await loadEmojiGroupItems(groupId));
  }

  async function uploadFaces(files: File[]): Promise<void> {
    const media = files.filter(isImageFile);
    if (media.length === 0 || !beginWrite()) return;
    try {
      const uploaded = await uploadFiles(media);
      if (uploaded.length === 0) {
        setError("没有可上传的图片");
        return;
      }
      await syncUrls(uploaded.map((file) => file.url), "上传");
    } catch (err) {
      setError(toUserErrorMessage(err));
    } finally {
      endWrite();
      if (faceInputRef.current) faceInputRef.current.value = "";
    }
  }

  async function addUrl(): Promise<void> {
    const url = /^https?:\/\//i.test(urlDraft.trim()) ? sanitizeHttpUrl(urlDraft) : null;
    if (url == null) {
      setError("表情地址必须是 http 或 https");
      return;
    }
    if (!beginWrite()) return;
    try {
      await addEmojiUrl(url, groupId ?? undefined);
      setUrlDraft("");
      setNotice("已同步到服务器表情");
      if (groupId != null) setItems(await loadEmojiGroupItems(groupId));
    } catch (err) {
      setError(toUserErrorMessage(err));
    } finally {
      endWrite();
    }
  }

  async function dropItem(item: EmojiItem): Promise<void> {
    if (!beginWrite()) return;
    try {
      await removeEmoji(item.groupId, item.emojiId);
      setItems((current) => current.filter((entry) => entry.emojiId !== item.emojiId));
      setNotice("已从服务器删除");
    } catch (err) {
      setError(toUserErrorMessage(err));
    } finally {
      endWrite();
    }
  }

  async function importFaces(file: File): Promise<void> {
    if (!beginWrite()) return;
    try {
      const urls = parseEmojiImport(await file.text());
      if (urls.length === 0) {
        setError("文件里没有可导入的表情地址");
        return;
      }
      await syncUrls(urls, "导入");
    } catch (err) {
      setError(toUserErrorMessage(err));
    } finally {
      endWrite();
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <div className="chat-emoji">
      <div className="chat-emoji-tabs" role="tablist" aria-label="表情">
        {([
          ["default", "默认"], ["favorites", "收藏"], ["server", "服务器"], ["recent", "最近"],
        ] as const).map(([value, label]) => (
          <Button key={value} type="button" role="tab" aria-selected={tab === value} size="xs"
            variant={tab === value ? "default" : "ghost"} disabled={busy} onClick={() => setTab(value)}>
            {label}
          </Button>
        ))}
      </div>
      {tab !== "favorites" && error ? <p className="chat-emoji-note" role="alert">{error}</p> : null}
      {tab !== "favorites" && notice ? <p className="chat-emoji-note" role="status">{notice}</p> : null}
      {tab === "default" ? (
        <div className="chat-emoji-grid" role="tabpanel" aria-label="默认表情">
          {DEFAULT_EMOJIS.map((emoji) => (
            <button key={emoji.name} type="button" className="chat-emoji-item"
              title={emoji.name} disabled={disabled}
              onClick={() => void remember({ kind: "shortcode", value: emoji.name }, `:${emoji.name}:`)}>
              <img src={emoji.url} alt={emoji.name} />
            </button>
          ))}
        </div>
      ) : null}
      {tab === "favorites" ? (
        <CloudEmojiFavorites disabled={disabled}
          onPick={(url) => void remember({ kind: "image", value: url }, imageToken(url))} />
      ) : null}
      {tab === "server" ? (
        <div role="tabpanel" aria-label="服务器表情">
          <div className="chat-emoji-tabs">
            {groups.map((group) => (
              <Button key={group.id} type="button" size="xs"
                variant={group.id === groupId ? "outline" : "ghost"} disabled={busy}
                onClick={() => setGroupId(group.id)}>{group.name || "未命名"}</Button>
            ))}
          </div>
          <div className="chat-emoji-grid" role="list">
            {items.map((item) => {
              const src = sanitizeHttpUrl(item.url);
              if (src == null) return null;
              return (
                <span key={item.id || item.emojiId} className="chat-emoji-server">
                  <button type="button" className="chat-emoji-item" title={item.name || "表情"} disabled={disabled}
                    onClick={() => void remember({ kind: "image", value: src }, imageToken(src))}>
                    <img src={src} alt={item.name || ""} />
                  </button>
                  <button type="button" className="chat-emoji-remove" disabled={disabled || busy}
                    onClick={() => void dropItem(item)}>删除</button>
                </span>
              );
            })}
          </div>
          <div className="chat-emoji-add">
            <input ref={faceInputRef} type="file" accept="image/*" multiple className="visually-hidden"
              aria-hidden="true" tabIndex={-1} onChange={(event) => void uploadFaces(Array.from(event.target.files ?? []))} />
            <Button type="button" size="xs" variant="outline" disabled={disabled || busy}
              onClick={() => faceInputRef.current?.click()}>选择图片上传</Button>
            <input className="chat-inline-input" value={urlDraft} placeholder="https:// 图片地址"
              aria-label="服务器表情图片地址" disabled={disabled || busy}
              onChange={(event) => setUrlDraft(event.target.value)} />
            <Button type="button" size="xs" variant="outline" disabled={disabled || busy || !urlDraft.trim()}
              onClick={() => void addUrl()}>同步到服务器</Button>
            <Button type="button" size="xs" variant="ghost"
              disabled={disabled || busy || sanitizeHttpUrl(urlDraft) == null}
              onClick={() => {
                const url = sanitizeHttpUrl(urlDraft);
                if (url) {
                  onInsert(imageToken(url));
                  setNotice("只插入了输入框，没有同步到服务器");
                }
              }}>仅插入</Button>
          </div>
          <div className="chat-emoji-io">
            <input ref={importInputRef} type="file" accept=".json,.txt,application/json,text/plain"
              className="visually-hidden" aria-hidden="true" tabIndex={-1} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFaces(file);
              }} />
            <Button type="button" size="xs" variant="outline" disabled={busy}
              onClick={() => {
                downloadEmojiJson(items.map((item) => ({ name: item.name, url: item.url })));
                setNotice(`已导出 ${items.length} 个服务器表情`);
              }}>导出分组</Button>
            <Button type="button" size="xs" variant="outline" disabled={disabled || busy}
              onClick={() => importInputRef.current?.click()}>导入分组</Button>
          </div>
        </div>
      ) : null}
      {tab === "recent" ? (
        <div role="tabpanel" aria-label="最近表情">
          <p className="chat-emoji-note">最近使用只存在本机，不代表服务器收藏。</p>
          {recent.length === 0 ? <p className="chat-emoji-note">还没有最近使用</p> : null}
          <div className="chat-emoji-grid">
            {recent.map((item) => {
              const known = item.kind === "shortcode"
                ? DEFAULT_EMOJIS.find((emoji) => emoji.name === item.value) : null;
              const src = item.kind === "image" ? sanitizeHttpUrl(item.value) : known?.url;
              if (item.kind === "image" && !src) return null;
              return (
                <button key={`${item.kind}:${item.value}`} type="button" className="chat-emoji-item" title={item.value}
                  disabled={disabled} onClick={() => onInsert(item.kind === "shortcode" ? `:${item.value}:` : imageToken(src!))}>
                  {src ? <img src={src} alt="" /> : <span>{item.value}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

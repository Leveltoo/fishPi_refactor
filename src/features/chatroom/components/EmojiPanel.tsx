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
import { toUserErrorMessage } from "../toUserError";
import { isImageFile, uploadFiles } from "../../../lib/upload";

type EmojiPanelProps = {
  disabled: boolean;
  onInsert: (token: string) => void;
};

type Tab = "default" | "server" | "recent";

function imageToken(url: string): string {
  return `![图片表情](${url})`;
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
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const faceInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRecentEmoji()
      .then((list) => {
        if (!cancelled) {
          setRecent(list);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecent([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== "server") {
      return;
    }
    let cancelled = false;
    setError(null);
    void loadEmojiGroups()
      .then((list) => {
        if (cancelled) {
          return;
        }
        setGroups(list);
        setGroupId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setGroups([]);
          setError(toUserErrorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    if (tab !== "server" || groupId == null) {
      return;
    }
    let cancelled = false;
    void loadEmojiGroupItems(groupId)
      .then((list) => {
        if (!cancelled) {
          setItems(list);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setItems([]);
          setError(toUserErrorMessage(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tab, groupId]);

  async function remember(item: RecentEmoji, token: string): Promise<void> {
    onInsert(token);
    try {
      const next = await rememberRecentEmoji(item);
      setRecent(next);
    } catch {
      // 插进输入框已经完成；最近使用记失败不影响发送。
    }
  }

  async function uploadFaces(files: File[]): Promise<void> {
    const media = files.filter(isImageFile);
    if (media.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const uploaded = await uploadFiles(media);
      if (uploaded.length === 0) {
        setError("没有可上传的图片");
        return;
      }
      let ok = 0;
      let fail = 0;
      for (const file of uploaded) {
        try {
          await addEmojiUrl(file.url, groupId ?? undefined);
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      if (groupId != null) {
        setItems(await loadEmojiGroupItems(groupId));
      }
      const summary = `成功上传 ${ok} 张，失败 ${fail} 张`;
      setNotice(summary);
      if (fail > 0) {
        toast.warning(summary);
      } else {
        toast.success(summary);
      }
    } catch (err) {
      const message = toUserErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      if (faceInputRef.current) {
        faceInputRef.current.value = "";
      }
    }
  }

  async function addUrl(): Promise<void> {
    const url = sanitizeHttpUrl(urlDraft);
    if (url == null || busy) {
      setError("表情地址必须是 http 或 https");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await addEmojiUrl(url, groupId ?? undefined);
      setUrlDraft("");
      setNotice("已同步到服务器表情");
      if (groupId != null) {
        setItems(await loadEmojiGroupItems(groupId));
      }
    } catch (err) {
      setError(toUserErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function dropItem(item: EmojiItem): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await removeEmoji(item.groupId, item.emojiId);
      setItems((current) => current.filter((entry) => entry.emojiId !== item.emojiId));
      setNotice("已从服务器删除");
    } catch (err) {
      setError(toUserErrorMessage(err));
    }
  }

  /** 导出当前分组收藏为 JSON 文件（对齐旧 faceExport）。 */
  function exportFaces(): void {
    downloadEmojiJson(items.map((item) => ({ name: item.name, url: item.url })));
    setNotice(`已导出 ${items.length} 个表情`);
  }

  /** 导入 JSON/文本：解析去重后逐个走 addEmojiUrl，汇总成功失败数。 */
  async function importFaces(file: File): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const urls = parseEmojiImport(text);
      if (urls.length === 0) {
        setError("文件里没有可导入的表情地址");
        return;
      }
      const existing = new Set(items.map((item) => item.url));
      let ok = 0;
      let fail = 0;
      for (const url of urls) {
        if (existing.has(url)) {
          continue;
        }
        try {
          await addEmojiUrl(url, groupId ?? undefined);
          existing.add(url);
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      if (groupId != null) {
        setItems(await loadEmojiGroupItems(groupId));
      }
      const summary = `成功导入 ${ok} 条，失败 ${fail} 条`;
      setNotice(summary);
      if (fail > 0) {
        toast.warning(summary);
      } else {
        toast.success(summary);
      }
    } catch (err) {
      const message = toUserErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="chat-emoji">
      <div className="chat-emoji-tabs" role="tablist">
        <Button type="button" size="xs" variant={tab === "default" ? "default" : "ghost"} onClick={() => setTab("default")}>
          默认
        </Button>
        <Button type="button" size="xs" variant={tab === "server" ? "default" : "ghost"} onClick={() => setTab("server")}>
          服务器
        </Button>
        <Button type="button" size="xs" variant={tab === "recent" ? "default" : "ghost"} onClick={() => setTab("recent")}>
          最近
        </Button>
      </div>
      {error ? <p className="chat-emoji-note">{error}</p> : null}
      {notice ? <p className="chat-emoji-note">{notice}</p> : null}

      {tab === "default" ? (
        <div className="chat-emoji-grid" role="list">
          {DEFAULT_EMOJIS.map((emoji) => (
            <button
              key={emoji.name}
              type="button"
              className="chat-emoji-item"
              title={emoji.name}
              disabled={disabled}
              onClick={() => {
                void remember({ kind: "shortcode", value: emoji.name }, `:${emoji.name}:`);
              }}
            >
              <img src={emoji.url} alt={emoji.name} />
            </button>
          ))}
        </div>
      ) : null}

      {tab === "server" ? (
        <>
          <p className="chat-emoji-note">
            服务器分组来自表情接口。添加成功才算已同步。云端旧收藏（cloud 存储）当前 SDK 无法读取，只能管理服务器分组里的表情。
          </p>
          <div className="chat-emoji-tabs">
            {groups.map((group) => (
              <Button
                key={group.id}
                type="button"
                size="xs"
                variant={group.id === groupId ? "outline" : "ghost"}
                onClick={() => setGroupId(group.id)}
              >
                {group.name || "未命名"}
              </Button>
            ))}
          </div>
          <div className="chat-emoji-grid" role="list">
            {items.map((item) => {
              const src = sanitizeHttpUrl(item.url);
              if (src == null) {
                return null;
              }
              return (
                <span key={item.id || item.emojiId} className="chat-emoji-server">
                  <button
                    type="button"
                    className="chat-emoji-item"
                    title={item.name || "表情"}
                    disabled={disabled}
                    onClick={() => {
                      void remember({ kind: "image", value: src }, imageToken(src));
                    }}
                  >
                    <img src={src} alt={item.name || ""} />
                  </button>
                  <button type="button" className="chat-emoji-remove" onClick={() => void dropItem(item)}>
                    删除
                  </button>
                </span>
              );
            })}
          </div>
          <div className="chat-emoji-add">
            <input
              ref={faceInputRef}
              type="file"
              accept="image/*"
              multiple
              className="visually-hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                void uploadFaces(Array.from(event.target.files ?? []));
              }}
            />
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => faceInputRef.current?.click()}
            >
              选择图片上传
            </Button>
            <input
              className="chat-inline-input"
              value={urlDraft}
              placeholder="https:// 图片地址"
              onChange={(event) => setUrlDraft(event.target.value)}
            />
            <Button type="button" size="xs" variant="outline" disabled={busy || urlDraft.trim().length === 0} onClick={() => void addUrl()}>
              同步到服务器
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={disabled || sanitizeHttpUrl(urlDraft) == null}
              onClick={() => {
                const url = sanitizeHttpUrl(urlDraft);
                if (url == null) {
                  return;
                }
                onInsert(imageToken(url));
                setNotice("只插入了输入框，没有同步到服务器");
              }}
            >
              仅插入
            </Button>
          </div>
          <div className="chat-emoji-io">
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json,text/plain"
              className="visually-hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void importFaces(file);
                }
              }}
            />
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={exportFaces}
            >
              导出收藏
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => importInputRef.current?.click()}
            >
              导入收藏
            </Button>
          </div>
        </>
      ) : null}

      {tab === "recent" ? (
        <>
          <p className="chat-emoji-note">最近使用只存在本机，不代表服务器收藏。</p>
          {recent.length === 0 ? <p className="chat-emoji-note">还没有最近使用</p> : null}
          <div className="chat-emoji-grid">
            {recent.map((item) => {
              if (item.kind === "shortcode") {
                const known = DEFAULT_EMOJIS.find((emoji) => emoji.name === item.value);
                return (
                  <button
                    key={`s:${item.value}`}
                    type="button"
                    className="chat-emoji-item"
                    title={item.value}
                    disabled={disabled}
                    onClick={() => onInsert(`:${item.value}:`)}
                  >
                    {known ? <img src={known.url} alt={item.value} /> : <span>{item.value}</span>}
                  </button>
                );
              }
              return (
                <button
                  key={`i:${item.value}`}
                  type="button"
                  className="chat-emoji-item"
                  disabled={disabled}
                  onClick={() => onInsert(imageToken(item.value))}
                >
                  <img src={item.value} alt="" />
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

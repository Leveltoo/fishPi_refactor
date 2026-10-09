import { useEffect, useRef, useState } from "react";
import { Download, Plus, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { appendCloudEmoji, refreshCloudEmoji, removeCloudEmoji } from "../chatroomApi";
import { AppInvokeError } from "../../../lib/errors";
import {
  CLOUD_EMOJI_MAX_FILE_BYTES,
  cloudEmojiUrl,
  parseCloudEmojiText,
  type CloudEmojiSnapshot,
} from "../cloudEmojiLogic";
import { downloadCloudEmojiText } from "../emojiImportExport";
import { isImageFile, uploadFiles } from "../../../lib/upload";
import { isOutcomeUnknown, toUserErrorMessage } from "../toUserError";

type Props = {
  disabled: boolean;
  onPick: (url: string) => void;
};

export function CloudEmojiFavorites({ disabled, onPick }: Props) {
  const [snapshot, setSnapshot] = useState<CloudEmojiSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const epoch = useRef(0);
  const busyRef = useRef(false);
  const unknownRef = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const importInput = useRef<HTMLInputElement | null>(null);

  async function reload(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    const token = ++epoch.current;
    setLoading(true);
    setError(null);
    try {
      const next = await refreshCloudEmoji();
      if (token === epoch.current) {
        setSnapshot(next);
        unknownRef.current = false;
        setUnknown(false);
        setNotice(null);
      }
    } catch (err) {
      if (token === epoch.current) setError(toUserErrorMessage(err));
    } finally {
      if (token === epoch.current) {
        busyRef.current = false;
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void reload();
    return () => {
      epoch.current += 1;
      busyRef.current = false;
    };
  }, []);

  async function write(
    operation: (current: CloudEmojiSnapshot) => Promise<CloudEmojiSnapshot>,
    success: string,
  ): Promise<void> {
    if (disabled || busyRef.current || unknownRef.current || snapshot == null) return;
    busyRef.current = true;
    const token = ++epoch.current;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await operation(snapshot);
      if (token === epoch.current) {
        setSnapshot(next);
        setNotice(success);
      }
    } catch (err) {
      if (token === epoch.current) {
        if (isOutcomeUnknown(err)) {
          unknownRef.current = true;
          setUnknown(true);
        }
        setError(toUserErrorMessage(err));
      }
    } finally {
      if (token === epoch.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  const cannotWrite = disabled || loading || busy || unknown || snapshot == null;
  const urls = snapshot?.urls ?? [];

  return (
    <div role="tabpanel" aria-label="收藏表情">
      {loading ? <p className="chat-emoji-note" role="status">读取收藏中...</p> : null}
      {error ? <p className="chat-emoji-note" role="alert">{error}</p> : null}
      {notice ? <p className="chat-emoji-note" role="status">{notice}</p> : null}
      {unknown ? <p className="chat-emoji-note" role="alert">结果待确认，请刷新收藏后再操作，勿重复提交。</p> : null}
      <div className="chat-emoji-grid">
        {urls.map((raw, index) => {
          const src = cloudEmojiUrl(raw);
          if (src == null) return null;
          return (
            <ContextMenu key={`${index}:${raw}`}>
              <ContextMenuTrigger asChild>
                <button type="button" className="chat-emoji-item" title="收藏表情" disabled={disabled}
                  onClick={() => onPick(src)}>
                  <img src={src} alt="" />
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent className="chat-menu">
                <ContextMenuItem variant="destructive" disabled={cannotWrite}
                  onSelect={() => void write((current) => removeCloudEmoji(current, raw), "已从收藏删除")}>
                  删除
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <div className="chat-emoji-io">
        <input ref={fileInput} type="file" accept="image/*" className="visually-hidden"
          aria-hidden="true" tabIndex={-1} onChange={(event) => {
            const files = Array.from(event.target.files ?? []).filter(isImageFile);
            if (files.length > 0) {
              void write(async (current) => {
                const uploaded = await uploadFiles(files);
                if (uploaded.length === 0) {
                  throw new AppInvokeError({ code: "business", message: "没有可上传的图片" });
                }
                return appendCloudEmoji(current, uploaded.map((file) => file.url));
              }, "已上传并加入收藏");
            }
            event.target.value = "";
          }} />
        <input ref={importInput} type="file" accept=".txt,text/plain" className="visually-hidden"
          aria-hidden="true" tabIndex={-1} onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void write(async (current) => {
                if (file.size > CLOUD_EMOJI_MAX_FILE_BYTES) {
                  throw new AppInvokeError({ code: "business", message: "收藏文件不能超过 512 KiB" });
                }
                const incoming = parseCloudEmojiText(await file.text());
                if (incoming.length === 0) {
                  throw new AppInvokeError({ code: "business", message: "文件里没有可导入的表情地址" });
                }
                return appendCloudEmoji(current, incoming);
              }, "已导入收藏");
            }
            event.target.value = "";
          }} />
        <Button type="button" size="icon-sm" variant="outline" title="添加收藏图片" aria-label="添加收藏图片"
          disabled={cannotWrite} onClick={() => fileInput.current?.click()}><Plus aria-hidden="true" /></Button>
        <Button type="button" size="icon-sm" variant="outline" title="导出收藏" aria-label="导出收藏"
          disabled={loading || busy || unknown || snapshot == null}
          onClick={() => downloadCloudEmojiText(urls)}><Download aria-hidden="true" /></Button>
        <Button type="button" size="icon-sm" variant="outline" title="导入收藏" aria-label="导入收藏"
          disabled={cannotWrite} onClick={() => importInput.current?.click()}><Upload aria-hidden="true" /></Button>
        <Button type="button" size="icon-sm" variant="ghost" title="刷新收藏" aria-label="刷新收藏"
          disabled={loading || busy} onClick={() => void reload()}><RefreshCw aria-hidden="true" /></Button>
      </div>
    </div>
  );
}

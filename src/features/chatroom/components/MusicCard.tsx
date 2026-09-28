import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sanitizeHttpUrl } from "../../../lib/markdown";
import { playNeteaseSong } from "@/features/music";
import type { MusicCard as MusicCardData } from "../messageView";

type MusicCardProps = {
  card: MusicCardData;
  fallback: string;
};

/** 与 Bridge `netease_audio_url` 同一提取规则：`source` 里第一段 1–20 位的 `id=`。 */
function neteaseSongId(raw: string | undefined): string | null {
  if (raw == null) {
    return null;
  }
  const marker = "id=";
  let rest = raw;
  for (;;) {
    const index = rest.indexOf(marker);
    if (index < 0) {
      return null;
    }
    const after = rest.slice(index + marker.length);
    const match = /^(\d{1,20})/.exec(after);
    if (match != null) {
      return match[1];
    }
    rest = after;
  }
}

export function MusicCard({ card, fallback }: MusicCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  const title = card.title.trim() || fallback.replace(/^【音乐】/, "").trim() || "未知曲目";
  const audioUrl = sanitizeHttpUrl(card.audioUrl);
  const coverUrl = coverBroken ? null : sanitizeHttpUrl(card.coverUrl);
  const from = card.from.trim();
  const songId = neteaseSongId(card.source) ?? neteaseSongId(card.audioUrl);

  async function toggle(): Promise<void> {
    const audio = audioRef.current;
    if (audio == null || audioUrl == null) {
      return;
    }
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    setFailed(false);
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setFailed(true);
    }
  }

  /** 交给 `PlaylistMount`，按桌面 music_mode（0 替换 / 1 加入 / 2 加入并播）处理。 */
  function addToPlaylist(): void {
    if (songId == null) {
      return;
    }
    const accepted = playNeteaseSong(songId);
    if (!accepted) {
      toast.warning("播放列表未就绪，请先打开侧栏「播放列表」");
      return;
    }
    toast.success("已交给播放列表");
  }

  return (
    <div className="chat-music">
      {coverUrl ? (
        <img
          className="chat-music-cover"
          src={coverUrl}
          alt=""
          onError={() => {
            setCoverBroken(true);
          }}
        />
      ) : null}
      <div className="chat-music-meta">
        <p className="chat-music-title">
          {title}
          {from.length > 0 ? <span> · {from}</span> : null}
        </p>
        {songId != null ? (
          <Button type="button" variant="outline" size="xs" onClick={addToPlaylist}>
            加入播放列表
          </Button>
        ) : null}
        {audioUrl == null ? (
          <p className="chat-music-state">没有音频地址，未在播放</p>
        ) : (
          <>
            <audio
              ref={audioRef}
              src={audioUrl}
              preload="none"
              onEnded={() => {
                setPlaying(false);
              }}
              onError={() => {
                setPlaying(false);
                setFailed(true);
              }}
            />
            <Button type="button" variant="outline" size="xs" onClick={() => void toggle()}>
              {playing ? "暂停" : "播放"}
            </Button>
            <p className="chat-music-state">
              {failed ? "这一首没播起来" : playing ? "正在播放这一首" : "未在播放"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

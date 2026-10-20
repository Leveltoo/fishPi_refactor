import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { sanitizeHttpUrl } from "../../../lib/markdown";
import { playNeteaseSong } from "@/features/music";
import { musicResolve, type SongInfo } from "@/features/music/api";
import type { MusicCard as MusicCardData } from "../messageView";

type MusicCardProps = { card: MusicCardData; fallback: string };

export function MusicCard({ card, fallback }: MusicCardProps) {
  const songId = /(?:[?&])id=(\d{1,20})(?:&|$)/.exec(card.source)?.[1] ??
    /(?:[?&])id=(\d{1,20})(?:&|$)/.exec(card.audioUrl ?? "")?.[1] ?? null;
  const [song, setSong] = useState<SongInfo | null>(null);
  const [coverBroken, setCoverBroken] = useState(false);
  const title = card.title.trim() || song?.name || fallback.replace(/^【音乐】/, "").trim() || "未知曲目";
  const coverUrl = coverBroken ? null : sanitizeHttpUrl(card.coverUrl || song?.cover);

  useEffect(() => {
    let cancelled = false;
    setSong(null);
    setCoverBroken(false);
    if (songId != null) {
      void musicResolve(songId).then((resolved) => {
        if (!cancelled) setSong(resolved);
      }).catch(() => {
        // Metadata is optional; the original message remains visible.
      });
    }
    return () => { cancelled = true; };
  }, [songId]);

  return (
    <Button type="button" variant="ghost" className="chat-music" disabled={songId == null}
      title="点击聆听" onClick={() => {
        if (songId != null && !playNeteaseSong(songId)) toast.error("播放列表未就绪");
      }}>
      <span className="chat-music-artwork">
        {coverUrl ? <img className="chat-music-cover" src={coverUrl} alt=""
          onError={() => setCoverBroken(true)} /> : null}
        <i className="fa fa-play chat-music-play" aria-hidden="true" />
      </span>
      <span className="chat-music-meta">
        <span className="chat-music-title">
          {title}{song?.artist ? <span> - {song.artist}</span> : null}
        </span>
        <span className="chat-music-state">点击聆听</span>
      </span>
    </Button>
  );
}

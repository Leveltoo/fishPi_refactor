import type { MusicCard } from "../chatroom/messageView";

type NeteaseHit = { kind: "song" | "album"; id: string };

function decodeQuery(raw: string): string {
  return raw.replace(/&amp;/g, "&");
}

function parseNetease(source: string): NeteaseHit | null {
  const player = source.match(/music\.163\.com\/outchain\/player\?([^"'<\s]*)/i);
  if (player) {
    const qs = decodeQuery(player[1]);
    const type = /(?:^|&)type=(\d)/.exec(qs)?.[1];
    const id = /(?:^|&)id=(\d{1,20})/.exec(qs)?.[1];
    if (id) {
      return { kind: type === "1" ? "album" : "song", id };
    }
  }
  const song = source.match(/music\.163\.com\/(?:#\/)?song\?id=(\d{1,20})/i);
  if (song) {
    return { kind: "song", id: song[1] };
  }
  const album = source.match(/music\.163\.com\/(?:#\/)?album\?id=(\d{1,20})/i);
  if (album) {
    return { kind: "album", id: album[1] };
  }
  return null;
}

/** 从正文抽出网易云歌曲卡。专辑 iframe 无法在 CSP 下播放，不伪造可播地址。 */
export function musicCardFromContent(source: string): MusicCard | null {
  const hit = parseNetease(source);
  if (hit == null || hit.kind !== "song") {
    return null;
  }
  return {
    title: "网易云音乐",
    source: `https://music.163.com/song?id=${hit.id}`,
    coverUrl: "",
    from: "网易云",
    audioUrl: `http://music.163.com/song/media/outer/url?id=${hit.id}`,
  };
}

export function stripNeteaseIframes(source: string): string {
  return source
    .replace(/<iframe\b[^>]*music\.163\.com[^>]*>\s*<\/iframe>/gi, "")
    .trim();
}

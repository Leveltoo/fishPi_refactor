export function neteasePlayer(raw: string): { src: string; songId: string | null; height: number } | null {
  try {
    if (!/^(?:https?:)?\/\//i.test(raw.trim())) return null;
    const url = new URL(raw.replace(/&amp;/g, "&"), "https://music.163.com");
    const id = url.searchParams.get("id") ?? "";
    const type = url.searchParams.get("type");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.hostname !== "music.163.com" || url.port ||
        url.pathname !== "/outchain/player" || !/^\d{1,20}$/.test(id) ||
        (type !== "1" && type !== "2")) return null;
    return {
      src: `https://music.163.com/outchain/player?type=${type}&id=${id}&auto=0&height=${type === "1" ? "430" : "66"}`,
      songId: type === "2" ? id : null,
      height: type === "1" ? 210 : 86,
    };
  } catch {
    return null;
  }
}

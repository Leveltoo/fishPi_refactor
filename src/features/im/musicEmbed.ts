import DOMPurify from "dompurify";

export function neteasePlayerUrl(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/&amp;/g, "&"), "https://music.163.com");
    const id = url.searchParams.get("id") ?? "";
    const type = url.searchParams.get("type");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        url.hostname !== "music.163.com" || url.port ||
        url.pathname !== "/outchain/player" || !/^\d{1,20}$/.test(id) ||
        (type !== "1" && type !== "2")) return null;
    return `https://music.163.com/outchain/player?type=${type}&id=${id}&auto=0&height=${type === "1" ? "430" : "66"}`;
  } catch {
    return null;
  }
}

export function safeMusicHtml(source: string): string {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  for (const element of Array.from(parsed.querySelectorAll<HTMLElement>("[style]"))) {
    const original = element.style;
    const styles: string[] = [];
    for (const property of ["color", "background-color", "font-weight", "font-style", "text-decoration", "text-align", "white-space"]) {
      const value = original.getPropertyValue(property);
      if (value && !/url|expression|var\(|\\/i.test(value)) styles.push(`${property}:${value}`);
    }
    if (styles.length) element.setAttribute("style", styles.join(";"));
    else element.removeAttribute("style");
  }
  for (const iframe of Array.from(parsed.querySelectorAll("iframe"))) {
    const src = neteasePlayerUrl(iframe.getAttribute("src") ?? "");
    if (!src) { iframe.remove(); continue; }
    iframe.setAttribute("src", src);
    iframe.setAttribute("height", new URL(src).searchParams.get("type") === "1" ? "210" : "86");
    iframe.setAttribute("width", "100%");
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.setAttribute("title", "网易云音乐");
    iframe.setAttribute("loading", "lazy");
    iframe.removeAttribute("style");
  }
  return DOMPurify.sanitize(parsed.body.innerHTML, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "b", "em", "i", "u", "s", "del", "a", "code", "pre",
      "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "img",
      "span", "div", "table", "thead", "tbody", "tr", "th", "td", "hr", "font",
      "iframe", "video", "source", "details", "summary",
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "class", "width", "height", "style", "color",
      "align", "target", "rel", "colspan", "rowspan", "start", "type", "frameborder",
      "sandbox", "loading", "controls", "poster", "preload", "playsinline", "open",
    ],
    ADD_URI_SAFE_ATTR: [
      "width", "height", "color", "align", "target", "rel", "colspan", "rowspan",
      "start", "type", "frameborder", "sandbox", "loading", "controls", "preload",
      "playsinline", "open",
    ],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|\/\/|#)/i,
    FORBID_TAGS: ["script", "object", "embed", "link", "meta", "form"],
    FORBID_ATTR: ["srcdoc"],
  });
}

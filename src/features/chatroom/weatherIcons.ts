const weatherIconUrls = import.meta.glob("../assets/weather/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
}) as Record<string, string>;

const ICONS = new Map<string, string>();
for (const [path, url] of Object.entries(weatherIconUrls)) {
  const name = path.split("/").pop()?.replace(/\.svg$/, "");
  if (name && typeof url === "string") {
    ICONS.set(name, url);
  }
}

/** 只显示仓库里已有的天气图。未知代码不编图标。 */
export function weatherIconUrl(code: string): string | null {
  if (!/^[A-Z0-9_]+$/.test(code)) {
    return null;
  }
  return ICONS.get(code) ?? null;
}

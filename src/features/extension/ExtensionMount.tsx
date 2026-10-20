import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { commandError, desktopPrefsGet } from "../desktop/api";
import {
  extensionCall,
  extensionLoadTheme,
  extensionScan,
  type ExtensionDetail,
  type ExtensionItem,
  type ExtensionScan,
} from "./api";
import { applyLegacyTheme } from "./theme";
import "./extension.css";

function safeDataIcon(icon: string): string | null {
  return /^data:image\/(?:png|jpeg|gif|webp|x-icon);base64,[A-Za-z0-9+/=]+$/.test(icon)
    ? icon
    : null;
}

function safeWebLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function ExtensionMount() {
  const [scan, setScan] = useState<ExtensionScan | null>(null);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<ExtensionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const revision = useRef(0);
  const detailRevision = useRef(0);

  async function refresh(): Promise<void> {
    const request = ++revision.current;
    detailRevision.current += 1;
    setDetail(null);
    setSelected("");
    setBusy(true);
    setError("");
    try {
      const prefs = await desktopPrefsGet();
      const listed = await extensionScan(prefs.extensionRoot || undefined);
      if (!mounted.current || request !== revision.current) return;
      setScan(listed);
      try {
        const loaded = await extensionLoadTheme(
          prefs.theme,
          prefs.extensionRoot || undefined,
        );
        if (mounted.current && request === revision.current) {
          applyLegacyTheme(loaded.applied ? loaded.css : "");
        }
      } catch {
        if (mounted.current && request === revision.current) {
          applyLegacyTheme("");
        }
      }
    } catch (err) {
      if (mounted.current && request === revision.current) {
        applyLegacyTheme("");
        setScan(null);
        setError(commandError(err));
      }
    } finally {
      if (mounted.current && request === revision.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    const stop = listen("desktop://prefs-changed", () => {
      if (alive) void refresh();
    });
    void stop
      .then(() => {
        if (alive) void refresh();
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(commandError(err));
          void refresh();
        }
      });
    return () => {
      alive = false;
      mounted.current = false;
      revision.current += 1;
      detailRevision.current += 1;
      void stop.then((unlisten) => unlisten()).catch(() => undefined);
      applyLegacyTheme("");
    };
  }, []);

  async function viewDetail(item: ExtensionItem): Promise<void> {
    const request = ++detailRevision.current;
    if (selected === item.key) {
      setSelected("");
      setDetail(null);
      return;
    }
    setSelected(item.key);
    setDetail(null);
    setError("");
    try {
      const result = await extensionCall("readme", item.key, scan?.root);
      if (mounted.current && request === detailRevision.current) setDetail(result);
    } catch (err) {
      if (mounted.current && request === detailRevision.current) {
        setError(commandError(err));
      }
    }
  }

  async function openLink(link: string): Promise<void> {
    const safe = safeWebLink(link);
    if (!safe) return;
    try {
      await openUrl(safe);
    } catch (err) {
      if (mounted.current) setError(commandError(err));
    }
  }

  const items = [...(scan?.plugins ?? []), ...(scan?.themes ?? [])];
  const selectedItem = items.find((item) => item.key === selected) ?? null;

  return (
    <section
      className="legacy-extension-page"
      aria-label="扩展"
      aria-busy={busy}
    >
      <section
        className={selected ? "legacy-ext-list-pane is-detail-open" : "legacy-ext-list-pane"}
      >
        <ScrollArea className="legacy-ext-scroll">
          <ul className="legacy-ext-list">
            {items.map((item) => (
              <ExtensionRow
                key={item.key}
                item={item}
                selected={selected === item.key}
                onDetail={() => void viewDetail(item)}
                onLink={(link) => void openLink(link)}
              />
            ))}
          </ul>
        </ScrollArea>
      </section>

      <section
        className={selected ? "legacy-ext-detail is-open" : "legacy-ext-detail"}
        aria-live="polite"
      >
        {selectedItem ? (
          <>
            <header className="legacy-ext-detail-head">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="legacy-ext-back"
                title="返回扩展列表"
                aria-label="返回扩展列表"
                onClick={() => {
                  detailRevision.current += 1;
                  setSelected("");
                  setDetail(null);
                }}
              >
                <i className="fa fa-arrow-left" aria-hidden="true" />
              </Button>
              <h2>{selectedItem.displayName || selectedItem.name}</h2>
              {[selectedItem.homepage, selectedItem.repository]
                .map(safeWebLink)
                .find((link): link is string => link != null) ? (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="legacy-ext-home"
                  onClick={() => {
                    const link = [selectedItem.homepage, selectedItem.repository]
                      .map(safeWebLink)
                      .find((value): value is string => value != null);
                    if (link) void openLink(link);
                  }}
                >
                  主页
                </Button>
              ) : null}
            </header>
            <ScrollArea className="legacy-ext-detail-scroll">
              <div className="md-style legacy-ext-readme">
                {detail ? (
                  detail.readme ? (
                    <ReactMarkdown
                      skipHtml
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: ({ href, children }) =>
                          href && safeWebLink(href) ? (
                            <Button
                              type="button"
                              variant="link"
                              size="xs"
                              className="legacy-ext-link"
                              onClick={() => void openLink(href)}
                            >
                              {children}
                            </Button>
                          ) : (
                            <span>{children}</span>
                          ),
                        img: ({ alt }) => <span>{alt ?? ""}</span>,
                      }}
                    >
                      {detail.readme}
                    </ReactMarkdown>
                  ) : (
                    <p>作者什么也没有介绍。</p>
                  )
                ) : null}
              </div>
            </ScrollArea>
          </>
        ) : null}
      </section>

      {error ? <p className="legacy-ext-error" role="alert">{error}</p> : null}
    </section>
  );
}

function ExtensionRow({
  item,
  selected,
  onDetail,
  onLink,
}: {
  item: ExtensionItem;
  selected: boolean;
  onDetail: () => void;
  onLink: (link: string) => void;
}) {
  const icon = safeDataIcon(item.icon);
  const link = safeWebLink(item.homepage || item.repository);

  return (
    <li className={selected ? "legacy-ext-item is-active" : "legacy-ext-item"}>
      <Button
        type="button"
        variant="ghost"
        className="legacy-ext-item-main"
        aria-pressed={selected}
        onClick={onDetail}
      >
        <span className="legacy-ext-icon">
          {icon ? <img src={icon} alt="" /> : <i className="fa fa-cube" aria-hidden="true" />}
        </span>
        <span className="legacy-ext-info">
          <span className="legacy-ext-title">
            <strong>{item.displayName || item.name}</strong>
            {item.version ? <small>{item.version}</small> : null}
          </span>
          <span className="legacy-ext-desc">{item.description}</span>
          <span className="legacy-ext-author">
            {item.author || "神秘开发者"}
          </span>
        </span>
      </Button>
      {link ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="legacy-ext-open"
          title="访问扩展主页"
          aria-label={`访问 ${item.displayName || item.name} 主页`}
          onClick={() => onLink(link)}
        >
          <i className="fa fa-external-link" aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
}

import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FolderOpen, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { commandError, desktopPrefsGet, desktopPrefsSet } from "../desktop/api";
import {
  extensionCall, extensionChooseDirectory, extensionLoadTheme, extensionScan,
  type ExtensionDetail, type ExtensionItem, type ExtensionScan,
} from "./api";
import { applyLegacyTheme } from "./theme";
import "../desktop/panel.css";
import "./extension.css";

function safeDataIcon(icon: string): string | null {
  if (!/^data:image\/(?:png|jpeg|gif|webp|x-icon);base64,[A-Za-z0-9+/=]+$/.test(icon)) {
    return null;
  }
  return icon;
}

function safeWebLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Read-only extension metadata and README, plus controlled legacy theme colors.
 */
export function ExtensionMount() {
  const [root, setRoot] = useState("");
  const [theme, setTheme] = useState("Default");
  const [scan, setScan] = useState<ExtensionScan | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<ExtensionDetail | null>(null);
  const mounted = useRef(false);
  const revision = useRef(0);
  const detailRevision = useRef(0);
  const savedRoot = useRef("");
  const pendingPicker = useRef<number | null>(null);

  async function refresh(): Promise<void> {
    const request = ++revision.current;
    detailRevision.current += 1;
    setDetail(null);
    setSelected("");
    setBusy(true);
    setError("");
    try {
      const prefs = await desktopPrefsGet();
      if (!mounted.current || request !== revision.current) {
        return;
      }
      const [listed, loaded] = await Promise.all([
        extensionScan(prefs.extensionRoot || undefined),
        extensionLoadTheme(prefs.theme, prefs.extensionRoot || undefined),
      ]);
      if (!mounted.current || request !== revision.current) {
        return;
      }
      savedRoot.current = prefs.extensionRoot;
      setRoot(prefs.extensionRoot);
      setTheme(prefs.theme);
      setScan(listed);
      const mapped = applyLegacyTheme(loaded.applied ? loaded.css : "");
      setNote(mapped.mapped
        ? `已应用 ${mapped.mapped} 项主题颜色，忽略 ${mapped.ignored} 项未适配样式。`
        : prefs.theme === "Default"
          ? "当前使用内置主题。"
          : loaded.applied
            ? "主题没有可适配的颜色，当前使用内置主题。"
            : loaded.message);
    } catch (err: unknown) {
      if (!mounted.current || request !== revision.current) {
        return;
      }
      applyLegacyTheme("");
      setScan(null);
      setError(commandError(err));
    } finally {
      if (mounted.current && request === revision.current) {
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    // Register first so importing settings while this panel stays mounted is observed.
    const stop = listen("desktop://prefs-changed", () => {
      if (alive) {
        void refresh();
      }
    });
    void stop.then(() => {
      if (alive) {
        void refresh();
      }
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
      pendingPicker.current = null;
      void stop.then((unlisten) => unlisten()).catch(() => undefined);
      applyLegacyTheme("");
    };
  }, []);

  async function save(patch: { extensionRoot?: string; theme?: string }): Promise<void> {
    const request = ++revision.current;
    setBusy(true);
    setError("");
    try {
      await desktopPrefsSet(patch);
      if (mounted.current && request === revision.current) {
        await refresh();
      }
    } catch (err: unknown) {
      if (mounted.current && request === revision.current) {
        setError(commandError(err));
        setBusy(false);
      }
    }
  }

  async function chooseDirectory(): Promise<void> {
    if (!mounted.current || busy || pendingPicker.current !== null) {
      return;
    }
    const request = ++revision.current;
    pendingPicker.current = request;
    setChoosing(true);
    try {
      const chosen = await extensionChooseDirectory(root.trim() || undefined);
      if (!mounted.current || request !== revision.current || chosen === null) {
        return;
      }
      setRoot(chosen);
      if (chosen !== savedRoot.current) {
        await save({ extensionRoot: chosen });
      }
    } catch (err: unknown) {
      if (mounted.current && request === revision.current) {
        setError(commandError(err));
      }
    } finally {
      if (pendingPicker.current === request) {
        pendingPicker.current = null;
        if (mounted.current) {
          setChoosing(false);
        }
      }
    }
  }

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
      if (mounted.current && request === detailRevision.current) {
        setDetail(result);
      }
    } catch (err: unknown) {
      if (mounted.current && request === detailRevision.current) {
        setError(commandError(err));
      }
    }
  }

  async function openLink(link: string): Promise<void> {
    const safe = safeWebLink(link);
    if (!safe) {
      return;
    }
    try {
      await openUrl(safe);
    } catch (err: unknown) {
      if (mounted.current) {
        setError(commandError(err));
      }
    }
  }

  const items = [...(scan?.plugins ?? []), ...(scan?.themes ?? [])];

  return (
    <section className="parity-panel extension-panel" aria-label="扩展" aria-busy={busy || choosing}>
      <section className="parity-section">
        <h2>本地扩展</h2>
        <div className="parity-row">
          <label htmlFor="extension-root">扩展目录</label>
          <input
            id="extension-root"
            value={root}
            disabled={busy || choosing}
            onChange={(event) => setRoot(event.target.value)}
            onBlur={() => {
              if (pendingPicker.current === null && root.trim() !== savedRoot.current) {
                void save({ extensionRoot: root.trim() });
              }
            }}
          />
          <button type="button" disabled={busy || choosing} title="选择扩展目录" aria-label="选择扩展目录"
            onMouseDown={(event) => {
              // Keep the draft intact when opening or cancelling the picker.
              if (event.button === 0) event.preventDefault();
            }}
            onClick={() => void chooseDirectory()}>
            <FolderOpen size={16} aria-hidden="true" />
          </button>
          <button type="button" disabled={busy || choosing} title="重新扫描" aria-label="重新扫描"
            onClick={() => void refresh()}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
        <label className="parity-row">
          主题
          <select
            value={theme}
            disabled={busy || choosing}
            onChange={(event) => {
              const next = event.target.value;
              setTheme(next);
              void save({ theme: next });
            }}
          >
            <option value="Default">默认</option>
            {theme !== "Default" && !(scan?.themes ?? []).some((item) => item.key === theme) ? (
              <option value={theme}>{theme}</option>
            ) : null}
            {(scan?.themes ?? []).map((item) => (
              <option key={item.key} value={item.key}>
                {item.description || item.displayName || item.name}
              </option>
            ))}
          </select>
        </label>
        <p className="parity-note">
          {note || "正在读取本地扩展。"}
        </p>
        {scan?.diagnostics.length ? (
          <ul className="parity-list">
            {scan.diagnostics.map((text, index) => <li key={index}>{text}</li>)}
          </ul>
        ) : null}
        {items.length ? (
          <ul className="parity-ext-list">
            {items.map((item) => (
              <ExtensionCard key={item.key} item={item} selected={selected === item.key}
                onDetail={() => void viewDetail(item)} onLink={(link) => void openLink(link)} />
            ))}
          </ul>
        ) : (
          <p className="parity-note">{busy ? "正在扫描。" : "没有可列出的本地扩展。"}</p>
        )}
      </section>

      {selected ? (
        <section className="parity-section extension-readme" aria-label="扩展详情" aria-live="polite">
          <h2>{items.find((item) => item.key === selected)?.displayName ?? selected}</h2>
          {detail ? (
            detail.readme ? (
              <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={{
                a: ({ href, children }) => href && safeWebLink(href)
                  ? <button type="button" className="parity-ext__link"
                      onClick={() => void openLink(href)}>{children}</button>
                  : <span>{children}</span>,
                img: ({ alt }) => <span>{alt ?? ""}</span>,
              }}>{detail.readme}</ReactMarkdown>
            ) : <p className="parity-note">作者没有提供介绍。</p>
          ) : <p className="parity-note">{error ? "详情未载入。" : "正在读取介绍。"}</p>}
        </section>
      ) : null}
      {error ? <p className="parity-error" role="alert">{error}</p> : null}
    </section>
  );
}

function ExtensionCard({ item, selected, onDetail, onLink }: {
  item: ExtensionItem;
  selected: boolean;
  onDetail: () => void;
  onLink: (link: string) => void;
}) {
  const icon = safeDataIcon(item.icon);
  const link = safeWebLink(item.homepage || item.repository);
  const title = item.displayName || item.name;

  return (
    <li className="parity-ext">
      {icon ? (
        <img className="parity-ext__icon" src={icon} alt="" />
      ) : (
        <span className="parity-ext__icon parity-ext__icon--empty" aria-hidden="true" />
      )}
      <div className="parity-ext__info">
        <h3 className="parity-ext__title">
          {link ? (
            <button
              type="button"
              className="parity-ext__link"
              onClick={() => onLink(link)}
            >
              {title}
            </button>
          ) : (
            title
          )}
          {item.version ? <sub>{item.version}</sub> : null}
        </h3>
        <p className="parity-ext__desc">{item.description || "作者什么也没有介绍。"}</p>
        <p className="parity-ext__author">{item.author || "神秘开发者"}（{item.kind === "theme" ? "主题" : "脚本未运行"}）</p>
        <button type="button" aria-pressed={selected} onClick={onDetail}>详情</button>
        {link ? (
          <p className="parity-ext__author">
            主页{" "}
            <button
              type="button"
              className="parity-ext__link"
              onClick={() => onLink(link)}
            >
              {link}
            </button>
          </p>
        ) : null}
      </div>
    </li>
  );
}

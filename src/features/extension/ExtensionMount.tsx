import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commandError, desktopPrefsGet, desktopPrefsSet } from "../desktop/api";
import { extensionLoadTheme, extensionScan, type ExtensionItem, type ExtensionScan } from "./api";
import "../desktop/panel.css";

const STYLE_ID = "fishpi-local-theme";

function applyCss(css: string): void {
  const current = document.getElementById(STYLE_ID);
  if (!css) {
    current?.remove();
    return;
  }
  const style = current instanceof HTMLStyleElement ? current : document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  if (!style.parentNode) {
    document.head.appendChild(style);
  }
}

function safeDataIcon(icon: string): string | null {
  if (!icon.startsWith("data:image/")) {
    return null;
  }
  return icon;
}

function pluginLink(item: ExtensionItem): string {
  return item.homepage || item.repository;
}

/**
 * 本机扩展目录：列出插件（图标 / 作者 / 主页），只注入一个本地主题 CSS。
 * 不执行 activate，不提供调试用 API 调用。
 */
export function ExtensionMount() {
  const [root, setRoot] = useState("");
  const [theme, setTheme] = useState("Default");
  const [scan, setScan] = useState<ExtensionScan | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);

  async function refresh(nextRoot: string, nextTheme: string): Promise<void> {
    setError("");
    try {
      const listed = await extensionScan(nextRoot || undefined);
      const loaded = await extensionLoadTheme(nextTheme, nextRoot || undefined);
      if (!mounted.current) {
        return;
      }
      setScan(listed);
      applyCss(loaded.applied ? loaded.css : "");
      setNote(loaded.message);
    } catch (err: unknown) {
      if (!mounted.current) {
        return;
      }
      applyCss("");
      setError(commandError(err));
    }
  }

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    void desktopPrefsGet()
      .then(async (prefs) => {
        if (!alive) {
          return;
        }
        setRoot(prefs.extensionRoot);
        setTheme(prefs.theme);
        try {
          const listed = await extensionScan(prefs.extensionRoot || undefined);
          const loaded = await extensionLoadTheme(prefs.theme, prefs.extensionRoot || undefined);
          if (!alive) {
            return;
          }
          setScan(listed);
          applyCss(loaded.applied ? loaded.css : "");
          setNote(loaded.message);
        } catch (err: unknown) {
          if (alive) {
            applyCss("");
            setError(commandError(err));
          }
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(commandError(err));
        }
      });
    return () => {
      alive = false;
      mounted.current = false;
      applyCss("");
    };
  }, []);

  async function save(nextRoot: string, nextTheme: string): Promise<void> {
    setError("");
    try {
      const prefs = await desktopPrefsSet({
        extensionRoot: nextRoot.trim(),
        theme: nextTheme,
      });
      setRoot(prefs.extensionRoot);
      setTheme(prefs.theme);
      await refresh(prefs.extensionRoot, prefs.theme);
    } catch (err: unknown) {
      setError(commandError(err));
    }
  }

  const plugins = scan?.plugins ?? [];

  return (
    <section className="parity-panel" aria-label="扩展">
      <section className="parity-section">
        <h2>本地扩展</h2>
        <label className="parity-row">
          扩展目录
          <input
            value={root}
            onChange={(event) => setRoot(event.target.value)}
            onBlur={() => void save(root, theme)}
          />
        </label>
        <label className="parity-row">
          主题
          <select
            value={theme}
            onChange={(event) => {
              const next = event.target.value;
              setTheme(next);
              void save(root, next);
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
          {note || scan?.message || "只读取本机目录，不下载远程插件，也不执行 activate。"}
        </p>
        {plugins.length ? (
          <ul className="parity-ext-list">
            {plugins.map((item) => (
              <ExtensionCard key={item.key} item={item} />
            ))}
          </ul>
        ) : (
          <p className="parity-note">没有可列出的本地插件。</p>
        )}
      </section>

      <section className="parity-section">
        <h2>不支持的插件 API</h2>
        <p className="parity-note">
          旧 Electron 插件 API 没有安全等价物。下列能力一律拒绝，不会在本页提供调试调用。
        </p>
        <ul className="parity-list">
          {(scan?.unsupported ?? []).map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </section>
      {error ? <p className="parity-error">{error}</p> : null}
    </section>
  );
}

function ExtensionCard({ item }: { item: ExtensionItem }) {
  const icon = safeDataIcon(item.icon);
  const link = pluginLink(item);
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
              onClick={() => {
                void openUrl(link).catch(() => undefined);
              }}
            >
              {title}
            </button>
          ) : (
            title
          )}
          {item.version ? <sub>{item.version}</sub> : null}
        </h3>
        <p className="parity-ext__desc">{item.description || "作者什么也没有介绍。"}</p>
        <p className="parity-ext__author">{item.author || "神秘开发者"}（未执行）</p>
        {link ? (
          <p className="parity-ext__author">
            主页{" "}
            <button
              type="button"
              className="parity-ext__link"
              onClick={() => {
                void openUrl(link).catch(() => undefined);
              }}
            >
              {link}
            </button>
          </p>
        ) : null}
      </div>
    </li>
  );
}

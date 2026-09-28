import { useEffect, useRef, useState } from "react";
import { commandError, desktopPrefsGet, desktopPrefsSet } from "../desktop/api";
import { extensionCall, extensionLoadTheme, extensionScan, type ExtensionScan } from "./api";
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

/**
 * 本机扩展目录：列出插件，只注入一个本地主题 CSS。
 * 不执行插件脚本。父组件自己挂到设置页。
 */
export function ExtensionMount() {
  const [root, setRoot] = useState("");
  const [theme, setTheme] = useState("Default");
  const [scan, setScan] = useState<ExtensionScan | null>(null);
  const [apiName, setApiName] = useState("electron.shell");
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

  async function callApi(): Promise<void> {
    setError("");
    try {
      await extensionCall(apiName);
      setNote("调用返回了成功，这不符合预期");
    } catch (err: unknown) {
      setError(commandError(err));
    }
  }

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
                {item.description || item.name}
              </option>
            ))}
          </select>
        </label>
        <p className="parity-note">{note || scan?.message || "只读取本机目录，不下载远程插件。"}</p>
        {scan?.plugins.length ? (
          <ul className="parity-list">
            {scan.plugins.map((item) => (
              <li key={item.key}>
                {item.name} {item.version}（未执行）
              </li>
            ))}
          </ul>
        ) : (
          <p className="parity-note">没有可列出的本地插件。</p>
        )}
      </section>

      <section className="parity-section">
        <h2>不支持的插件 API</h2>
        <ul className="parity-list">
          {(scan?.unsupported ?? []).map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <div className="parity-row">
          <input value={apiName} onChange={(event) => setApiName(event.target.value)} />
          <button type="button" onClick={() => void callApi()}>
            调用
          </button>
        </div>
      </section>
      {error ? <p className="parity-error">{error}</p> : null}
    </section>
  );
}

import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import legacyIcon from "@/assets/legacy/icon.png";
import { desktopPrefsGet, desktopPrefsSet } from "@/features/desktop/api";
import { invokeAuthLogin } from "../../lib/tauri";
import type { AuthSession } from "../../lib/types";
import { TitleBar } from "../shell/TitleBar";
import { authErrorMessage } from "./auth-errors";
import "./LoginPage.css";

const REGISTER_URL = "https://fishpi.cn/register?r=imlinhanchao";

export type LoginPageProps = {
  notice?: string;
  submittingFromGate?: boolean;
  onLoggedIn: (session: AuthSession) => void;
  onRestoreSession: () => void;
};

export function LoginPage({
  notice,
  submittingFromGate = false,
  onLoggedIn,
}: LoginPageProps) {
  const passwordRef = useRef<HTMLInputElement>(null);
  const mfaRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void desktopPrefsGet()
      .then((prefs) => {
        if (alive && prefs.loginUsername) {
          setUsername(prefs.loginUsername);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const busy = submitting || submittingFromGate;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const name = username.trim();
    if (!name) {
      setError("请输入您的用户名");
      return;
    }
    if (!password) {
      setError("请输入您的密码");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const session = await invokeAuthLogin({
        username: name,
        password,
        mfaCode: mfaCode.trim() || undefined,
      });
      setPassword("");
      setMfaCode("");
      void desktopPrefsSet({ loginUsername: name }).catch(() => undefined);
      onLoggedIn(session);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister() {
    try {
      await openUrl(REGISTER_URL);
    } catch {
      setError(`请到网站注册：${REGISTER_URL}`);
    }
  }

  return (
    <div className="legacy-login">
      <TitleBar title="摸鱼派 - 登录" compact />
      <main className="login-content">
        <section className="login-logo">
          <img src={legacyIcon} alt="" />
          <span>摸鱼派·登录</span>
        </section>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          {notice ? <p className="login-message">{notice}</p> : null}

          <div className="login-field">
            <span className="login-input-addon">
              <i className="fa fa-user" aria-hidden="true" />
            </span>
            <Input
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="用户名"
              value={username}
              disabled={busy}
              aria-label="用户名"
              autoFocus
              onChange={(event) => setUsername(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  passwordRef.current?.focus();
                }
              }}
            />
          </div>

          <div className="login-field">
            <span className="login-input-addon">
              <i className="fa fa-lock" aria-hidden="true" />
            </span>
            <Input
              ref={passwordRef}
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              placeholder="密码"
              value={password}
              disabled={busy}
              aria-label="密码"
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  mfaRef.current?.focus();
                }
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="login-password-toggle"
              disabled={busy}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              onClick={() => setShowPassword((current) => !current)}
            >
              <i
                className={showPassword ? "fa fa-eye-slash" : "fa fa-eye"}
                aria-hidden="true"
              />
            </Button>
          </div>

          <div className="login-field">
            <span className="login-input-addon">
              <i className="fa fa-shield" aria-hidden="true" />
            </span>
            <Input
              ref={mfaRef}
              type="text"
              name="mfaCode"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="两步验证码"
              value={mfaCode}
              disabled={busy}
              aria-label="两步验证码"
              onChange={(event) => setMfaCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </div>

          {error ? <p className="login-message login-message--error">{error}</p> : null}

          <div className="login-footer">
            <Button type="submit" className="login-button login-button--success" disabled={busy}>
              {busy ? <i className="fa fa-spinner fa-spin" aria-hidden="true" /> : null}
              {busy ? "登录中" : "登录"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="login-button login-button--default"
              disabled={busy}
              onClick={() => void handleRegister()}
            >
              注册
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

/**
 * 登录页：用户名、密码、可选 MFA。
 * 密码只在提交时交给 auth_login，不写入 localStorage。
 *
 * 依赖 src/lib/tauri.ts 的 invokeAuthLogin（前端类型化 API agent）。
 */
import { openUrl } from "@tauri-apps/plugin-opener";
import { Eye, EyeOff, Lock, Shield, User } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { invokeAuthLogin } from "../../lib/tauri";
import type { AuthSession } from "../../lib/types";
import { FishMark } from "../shell/FishMark";
import { TitleBar } from "../shell/TitleBar";
import { authErrorMessage } from "./auth-errors";
import "./LoginPage.css";

const REGISTER_URL = "https://fishpi.cn/register";

export type LoginPageProps = {
  notice?: string;
  submittingFromGate?: boolean;
  onLoggedIn: (session: AuthSession) => void;
};

export function LoginPage({
  notice,
  submittingFromGate = false,
  onLoggedIn,
}: LoginPageProps) {
  const formId = useId();
  const usernameId = `${formId}-username`;
  const passwordId = `${formId}-password`;
  const mfaId = `${formId}-mfa`;
  const errorId = `${formId}-error`;
  const noticeId = `${formId}-notice`;
  const registerHintId = `${formId}-register-hint`;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registerHint, setRegisterHint] = useState(false);

  const busy = submitting || submittingFromGate;
  const invalid = Boolean(error);
  const describedBy =
    [notice ? noticeId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }

    const trimmedName = username.trim();
    if (!trimmedName) {
      setError("请输入用户名");
      return;
    }
    if (!password) {
      setError("请输入密码");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const session = await invokeAuthLogin({
        username: trimmedName,
        password,
        mfaCode: mfaCode.trim() || undefined,
      });
      setPassword("");
      setMfaCode("");
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
      setRegisterHint(false);
    } catch {
      setRegisterHint(true);
    }
  }

  return (
    <div className="login-shell">
      {/* decorations:false 时登录页也要有可拖窗顶栏；对齐旧版 simple：只留最小化/关闭 */}
      <TitleBar title="摸鱼派" compact />
      <div className="login-page">
      <div className="login-logo">
        <span className="login-logo__mark" aria-hidden="true">
          <FishMark className="login-logo__mark-icon" />
        </span>
        <h1 className="login-logo__title">摸鱼派·登录</h1>
      </div>

      <form className="login-form" onSubmit={handleSubmit} noValidate>
        {notice ? (
          <Alert className="login-alert login-alert--notice" id={noticeId}>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert
            variant="destructive"
            className="login-alert login-alert--error"
            id={errorId}
          >
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="login-form__fields">
          <InputGroup className="login-field">
            <InputGroupAddon align="inline-start" className="login-field__lead">
              <User aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id={usernameId}
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="用户名"
              value={username}
              disabled={busy}
              autoFocus
              aria-label="用户名"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => setUsername(event.target.value)}
            />
          </InputGroup>

          <InputGroup className="login-field">
            <InputGroupAddon align="inline-start" className="login-field__lead">
              <Lock aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id={passwordId}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="密码"
              value={password}
              disabled={busy}
              aria-label="密码"
              aria-invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => setPassword(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                disabled={busy}
                aria-pressed={showPassword}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>

          <InputGroup className="login-field">
            <InputGroupAddon align="inline-start" className="login-field__lead">
              <Shield aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id={mfaId}
              name="mfaCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="两步验证码（可留空）"
              value={mfaCode}
              disabled={busy}
              aria-label="两步验证码"
              aria-describedby={describedBy}
              onChange={(event) => setMfaCode(event.target.value)}
            />
          </InputGroup>
        </div>

        <div className="login-form__actions">
          <Button
            type="submit"
            className="login-form__submit"
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            {busy ? "登录中…" : "登录"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="login-form__register"
            disabled={busy}
            aria-describedby={registerHint ? registerHintId : undefined}
            onClick={() => void handleRegister()}
          >
            注册
          </Button>
        </div>

        {registerHint ? (
          <Alert
            className="login-alert login-alert--notice"
            id={registerHintId}
          >
            <AlertDescription>请到网站注册：{REGISTER_URL}</AlertDescription>
          </Alert>
        ) : null}
      </form>
      </div>
    </div>
  );
}

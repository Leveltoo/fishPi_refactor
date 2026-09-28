import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Pin, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_SETTINGS,
  OPACITY_MIN,
} from "@/features/settings/constants";
import {
  invokeAlwaysOnTop,
  invokeSettingsSet,
  invokeWindowOpacity,
  normalizeSettings,
} from "@/features/settings/api";
import {
  currentDesktopSettings,
  publishDesktopSettings,
  subscribeDesktopSettings,
} from "@/features/settings/settingsStore";

type WinBtnProps = {
  label: string;
  className?: string;
  Icon?: typeof Minus;
  customIcon?: ReactNode;
  onClick?: () => void;
  pressed?: boolean;
};

function WinBtn({
  label,
  className,
  Icon,
  customIcon,
  onClick,
  pressed,
}: WinBtnProps) {
  const classes = ["shell__win-btn"];
  if (className) {
    classes.push(className);
  }
  if (pressed) {
    classes.push("is-on");
  }
  return (
    <button
      type="button"
      className={classes.join(" ")}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {customIcon ?? (Icon ? <Icon /> : null)}
    </button>
  );
}

/** 唯一顶栏右侧窗控：最小化=缩到托盘、透明、置顶、关闭（close_to_tray）。 */
export function WindowControls({ compact = false }: { compact?: boolean }) {
  const [alwaysOnTop, setAlwaysOnTop] = useState(DEFAULT_SETTINGS.alwaysOnTop);
  const [settingsOpacity, setSettingsOpacity] = useState(
    DEFAULT_SETTINGS.opacity,
  );
  const [dimmed, setDimmed] = useState(false);

  useEffect(() => {
    return subscribeDesktopSettings((snapshot) => {
      setAlwaysOnTop(snapshot.settings.alwaysOnTop);
      setSettingsOpacity(snapshot.settings.opacity);
    });
  }, []);

  const onMinimize = useCallback(() => {
    void (async () => {
      try {
        const win = getCurrentWindow();
        await win.minimize();
      } catch {
        try {
          await getCurrentWindow().hide();
        } catch {
          // 非 Tauri
        }
      }
    })();
  }, []);

  const onToggleOpacity = useCallback(() => {
    void (async () => {
      const nextDimmed = !dimmed;
      const target = nextDimmed ? OPACITY_MIN : settingsOpacity;
      try {
        await invokeWindowOpacity(target);
        setDimmed(nextDimmed);
      } catch {
        setDimmed(nextDimmed);
      }
    })();
  }, [dimmed, settingsOpacity]);

  const onTogglePin = useCallback(() => {
    void (async () => {
      const next = !alwaysOnTop;
      try {
        const result = await invokeAlwaysOnTop(next);
        setAlwaysOnTop(next);
        if (result.status === "ok") {
          const base = currentDesktopSettings()?.settings ?? DEFAULT_SETTINGS;
          const settings = normalizeSettings({ ...base, alwaysOnTop: next });
          publishDesktopSettings({ ready: true, settings });
          void invokeSettingsSet(settings);
        }
      } catch {
        setAlwaysOnTop(next);
      }
    })();
  }, [alwaysOnTop]);

  const onClose = useCallback(() => {
    void (async () => {
      try {
        await getCurrentWindow().close();
      } catch {
        // 非 Tauri 环境
      }
    })();
  }, []);

  // compact（登录等 simple 顶栏）：只留最小化/关闭，对齐旧版 simple 模式
  return (
    <div className="shell__win-ctrl">
      <WinBtn label="最小化" Icon={Minus} onClick={onMinimize} />
      {compact ? null : (
        <>
          <WinBtn
            label="透明窗体"
            className="win-opacity-btn"
            customIcon={<span className="cirle-empty" aria-hidden="true" />}
            pressed={dimmed}
            onClick={onToggleOpacity}
          />
          <WinBtn
            label="窗口置顶"
            className="win-pin-btn"
            Icon={Pin}
            pressed={alwaysOnTop}
            onClick={onTogglePin}
          />
        </>
      )}
      <WinBtn
        label="关闭"
        className="is-close"
        Icon={X}
        onClick={onClose}
      />
    </div>
  );
}

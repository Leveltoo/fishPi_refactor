import { Minus, Pin, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS } from "@/features/settings/constants";
import {
  invokeAlwaysOnTop,
  invokeSettingsSet,
  normalizeSettings,
} from "@/features/settings/api";
import {
  currentDesktopSettings,
  publishDesktopSettings,
  subscribeDesktopSettings,
} from "@/features/settings/settingsStore";
import {
  closeMainWindow,
  hideMainToTray,
  toggleWindowOpacity,
} from "./windowActions";

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

/** 唯一顶栏右侧窗控：最小化=藏到托盘、透明、置顶、关闭（close_to_tray）。 */
export function WindowControls({ compact = false }: { compact?: boolean }) {
  const [alwaysOnTop, setAlwaysOnTop] = useState(DEFAULT_SETTINGS.alwaysOnTop);
  const [settingsOpacity, setSettingsOpacity] = useState(
    DEFAULT_SETTINGS.opacity,
  );
  const [opacityEnabled, setOpacityEnabled] = useState(
    DEFAULT_SETTINGS.opacityEnabled,
  );

  useEffect(() => {
    return subscribeDesktopSettings((snapshot) => {
      setAlwaysOnTop(snapshot.settings.alwaysOnTop);
      setSettingsOpacity(snapshot.settings.opacity);
      setOpacityEnabled(snapshot.settings.opacityEnabled);
    });
  }, []);

  const onMinimize = useCallback(() => {
    void hideMainToTray();
  }, []);

  const onToggleOpacity = useCallback(() => {
    void toggleWindowOpacity(opacityEnabled, settingsOpacity).then(
      setOpacityEnabled,
    );
  }, [opacityEnabled, settingsOpacity]);

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
    void closeMainWindow();
  }, []);

  return (
    <div className="shell__win-ctrl">
      <WinBtn label="最小化" Icon={Minus} onClick={onMinimize} />
      {compact ? null : (
        <>
          <WinBtn
            label="透明窗体"
            className="win-opacity-btn"
            customIcon={<span className="cirle-empty" aria-hidden="true" />}
            pressed={opacityEnabled}
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

import { useCallback, useEffect, useRef, useState } from "react";

import {
  clampOpacity,
  invokeAlwaysOnTop,
  invokeNotifyShow,
  invokeSettingsGet,
  invokeSettingsSet,
  invokeWindowOpacity,
  normalizeSettings,
} from "./api";
import { BRIDGE_GAP_DETAIL, DEFAULT_SETTINGS } from "./constants";
import { publishDesktopSettings } from "./settingsStore";
import { applyTheme, bootDefaultTheme } from "./theme";
import type { DesktopSettings, ThemeId } from "./types";

const OPACITY_DEBOUNCE_MS = 180;

type SettingsNotice = {
  kind: "gap" | "error" | "ok";
  text: string;
};

export function useDesktopSettings() {
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<SettingsNotice | null>(null);
  const [notifyTesting, setNotifyTesting] = useState(false);
  const settingsRef = useRef(settings);
  const opacityTimer = useRef(0);
  const persistTimer = useRef(0);
  const gen = useRef(0);

  settingsRef.current = settings;

  useEffect(() => {
    bootDefaultTheme();
    let cancelled = false;
    const token = ++gen.current;

    void (async () => {
      const result = await invokeSettingsGet();
      if (cancelled || token !== gen.current) {
        return;
      }
      if (result.status === "ok") {
        settingsRef.current = result.data;
        setSettings(result.data);
        applyTheme(result.data.themeId);
        publishDesktopSettings({ ready: true, settings: result.data });
        setNotice(null);
      } else if (result.status === "gap") {
        setNotice({ kind: "gap", text: BRIDGE_GAP_DETAIL });
      } else {
        setNotice({ kind: "error", text: result.message });
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(opacityTimer.current);
      window.clearTimeout(persistTimer.current);
    };
  }, []);

  const pushNotice = useCallback((next: SettingsNotice) => {
    setNotice((current) => {
      if (current?.kind === "gap" && next.kind === "ok") {
        return current;
      }
      return next;
    });
  }, []);

  const persist = useCallback((next: DesktopSettings, delay = 0) => {
    window.clearTimeout(persistTimer.current);
    const run = async () => {
      setSaving(true);
      const result = await invokeSettingsSet(next);
      setSaving(false);
      if (result.status === "gap") {
        pushNotice({ kind: "gap", text: BRIDGE_GAP_DETAIL });
        return;
      }
      if (result.status === "error") {
        pushNotice({ kind: "error", text: result.message });
      }
    };
    if (delay <= 0) {
      void run();
      return;
    }
    persistTimer.current = window.setTimeout(() => {
      void run();
    }, delay);
  }, [pushNotice]);

  const patch = useCallback(
    (partial: Partial<DesktopSettings>) => {
      const next = normalizeSettings({ ...settingsRef.current, ...partial });
      settingsRef.current = next;
      setSettings(next);
      publishDesktopSettings({ ready: true, settings: next });

      if (partial.themeId) {
        applyTheme(next.themeId);
      }

      if (partial.alwaysOnTop !== undefined) {
        void invokeAlwaysOnTop(next.alwaysOnTop).then((result) => {
          if (result.status === "gap") {
            pushNotice({ kind: "gap", text: BRIDGE_GAP_DETAIL });
          } else if (result.status === "error") {
            pushNotice({ kind: "error", text: result.message });
          }
        });
      }

      if (partial.opacity !== undefined || partial.opacityEnabled !== undefined) {
        window.clearTimeout(opacityTimer.current);
        opacityTimer.current = window.setTimeout(() => {
          void invokeWindowOpacity(
            next.opacityEnabled ? next.opacity : 1,
          ).then((result) => {
            if (result.status === "gap") {
              pushNotice({ kind: "gap", text: BRIDGE_GAP_DETAIL });
            } else if (result.status === "error") {
              pushNotice({ kind: "error", text: result.message });
            }
          });
        }, OPACITY_DEBOUNCE_MS);
        persist(next, OPACITY_DEBOUNCE_MS);
        return;
      }

      persist(next);
    },
    [persist, pushNotice],
  );

  const setTheme = useCallback(
    (themeId: ThemeId) => {
      patch({ themeId });
    },
    [patch],
  );

  const setAlwaysOnTop = useCallback(
    (alwaysOnTop: boolean) => {
      patch({ alwaysOnTop });
    },
    [patch],
  );

  const setOpacity = useCallback(
    (opacity: number) => {
      patch({ opacity: clampOpacity(opacity) });
    },
    [patch],
  );

  const setOpacityEnabled = useCallback(
    (opacityEnabled: boolean) => {
      patch({ opacityEnabled });
    },
    [patch],
  );

  const setCloseToTray = useCallback(
    (closeToTray: boolean) => {
      patch({ closeToTray });
    },
    [patch],
  );

  const setBossKey = useCallback(
    (bossKey: string) => {
      patch({ bossKey });
    },
    [patch],
  );

  const setNotifyEnabled = useCallback(
    (notifyEnabled: boolean) => {
      patch({ notifyEnabled });
    },
    [patch],
  );

  const testNotify = useCallback(async () => {
    if (notifyTesting) {
      return;
    }
    setNotifyTesting(true);
    const result = await invokeNotifyShow({
      title: "摸鱼派",
      body: "这是一条测试通知。",
    });
    setNotifyTesting(false);
    if (result.status === "gap") {
      pushNotice({ kind: "gap", text: BRIDGE_GAP_DETAIL });
      return;
    }
    if (result.status === "error") {
      pushNotice({ kind: "error", text: result.message });
      return;
    }
    pushNotice({
      kind: "ok",
      text: "已请求系统通知。若没看到，请检查系统权限。",
    });
  }, [notifyTesting, pushNotice]);

  return {
    settings,
    loading,
    saving,
    notice,
    notifyTesting,
    setTheme,
    setAlwaysOnTop,
    setOpacity,
    setOpacityEnabled,
    setCloseToTray,
    setBossKey,
    setNotifyEnabled,
    update: patch,
    testNotify,
  };
}

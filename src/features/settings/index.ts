import { invokeSettingsGet } from "./api";
import { publishDesktopSettings } from "./settingsStore";
import { applyTheme, bootDefaultTheme } from "./theme";

bootDefaultTheme();
void invokeSettingsGet().then((result) => {
  if (result.status === "ok") {
    applyTheme(result.data.themeId);
    publishDesktopSettings({ ready: true, settings: result.data });
  }
});

export { SettingsHost } from "./SettingsHost";

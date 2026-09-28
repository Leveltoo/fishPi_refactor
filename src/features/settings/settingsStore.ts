import type { DesktopSettings } from "./types";

export type DesktopSettingsSnapshot = {
  ready: boolean;
  settings: DesktopSettings;
};

type Listener = (snapshot: DesktopSettingsSnapshot) => void;

let current: DesktopSettingsSnapshot | null = null;
const listeners = new Set<Listener>();

export function publishDesktopSettings(snapshot: DesktopSettingsSnapshot): void {
  current = snapshot;
  listeners.forEach((listener) => listener(snapshot));
}

export function currentDesktopSettings(): DesktopSettingsSnapshot | null {
  return current;
}

export function subscribeDesktopSettings(listener: Listener): () => void {
  listeners.add(listener);
  if (current) {
    listener(current);
  }
  return () => {
    listeners.delete(listener);
  };
}

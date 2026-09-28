import { useEffect, useState } from "react";

type Listener = (total: number) => void;

let total = 0;
const listeners = new Set<Listener>();

export function sumUnread(items: readonly { unread: number }[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.unread), 0);
}

/** 把现有会话未读合计交给侧栏。不另造一套计数。 */
export function publishImUnread(next: number): void {
  const value = Math.max(0, Math.floor(next));
  if (value === total) {
    return;
  }
  total = value;
  listeners.forEach((listener) => listener(total));
}

export function useImUnreadTotal(): number {
  const [value, setValue] = useState(total);
  useEffect(() => {
    setValue(total);
    const listener: Listener = (next) => setValue(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return value;
}

import { sanitizeHttpUrl } from "../../lib/markdown";

/** Markdown / 帖子点击图片时派发。 */
export const PREVIEW_IMAGE_EVENT = "fishpi:preview-image";

/** 点击用户名、@ 链接或 @ 列表头像时派发。 */
export const USER_CARD_EVENT = "fishpi:user-card";

export type PreviewImageDetail = {
  src: string;
  alt?: string;
};

export type UserCardDetail = {
  userName: string;
};

const MEMBER_PATH = /^\/member\/([^/]+)\/?$/i;

export function dispatchPreviewImage(detail: PreviewImageDetail): void {
  window.dispatchEvent(
    new CustomEvent<PreviewImageDetail>(PREVIEW_IMAGE_EVENT, { detail }),
  );
}

export function dispatchUserCard(userName: string): void {
  const trimmed = userName.trim();
  if (!trimmed) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<UserCardDetail>(USER_CARD_EVENT, {
      detail: { userName: trimmed },
    }),
  );
}

export function parsePreviewImage(event: Event): PreviewImageDetail | null {
  const record = asRecord(readDetail(event));
  const src = sanitizeHttpUrl(
    record ? readNonEmptyString(record.src) : readNonEmptyString(readDetail(event)),
  );
  if (!src) {
    return null;
  }
  const alt = record ? readNonEmptyString(record.alt) : undefined;
  return alt ? { src, alt } : { src };
}

export function parseUserCard(event: Event): string | null {
  const detail = readDetail(event);
  if (typeof detail === "string") {
    const name = detail.trim();
    return name.length > 0 ? name : null;
  }
  const record = asRecord(detail);
  const userName = record
    ? readNonEmptyString(record.userName) ?? readNonEmptyString(record.username)
    : undefined;
  return userName ?? null;
}

/** `https://fishpi.cn/member/name` 或链接文字 `@name`。 */
export function mentionUserFromLink(
  href: string | null,
  text: string | null,
): string | undefined {
  const fromText = text?.trim().match(/^@([^\s@]+)$/);
  if (fromText) {
    return fromText[1];
  }
  const safe = sanitizeHttpUrl(href);
  if (!safe) {
    return undefined;
  }
  try {
    const match = new URL(safe).pathname.match(MEMBER_PATH);
    return match ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function readDetail(event: Event): unknown {
  if ("detail" in event) {
    return (event as CustomEvent).detail;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

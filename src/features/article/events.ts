export const PREVIEW_IMAGE_EVENT = "fishpi:preview-image";
export const USER_CARD_EVENT = "fishpi:user-card";

export type PreviewImageDetail = {
  src: string;
  alt?: string;
};

export type UserCardDetail = {
  userName: string;
};

export function dispatchPreviewImage(src: string, alt?: string): void {
  const href = src.trim();
  if (!href) {
    return;
  }
  const detail: PreviewImageDetail = alt?.trim()
    ? { src: href, alt: alt.trim() }
    : { src: href };
  window.dispatchEvent(new CustomEvent(PREVIEW_IMAGE_EVENT, { detail }));
}

export function dispatchUserCard(userName: string): void {
  const name = userName.trim();
  if (!name) {
    return;
  }
  const detail: UserCardDetail = { userName: name };
  window.dispatchEvent(new CustomEvent(USER_CARD_EVENT, { detail }));
}

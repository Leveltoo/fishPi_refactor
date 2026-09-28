import { sanitizeHttpUrl } from "../../lib/markdown";

/** 点击用户头像 / 用户名时派发，供名片 overlay 监听。 */
export const USER_CARD_EVENT = "fishpi:user-card";

/** 点击正文图片时派发，供看图 overlay 监听。 */
export const PREVIEW_IMAGE_EVENT = "fishpi:preview-image";

export type FishpiUserCardDetail = {
  userName: string;
  userAvatarUrl?: string;
};

export type FishpiPreviewImageDetail = {
  src: string;
  alt?: string;
};

export function dispatchUserCard(detail: FishpiUserCardDetail): void {
  const userName = detail.userName.trim();
  if (userName.length === 0) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<FishpiUserCardDetail>(USER_CARD_EVENT, {
      detail: {
        userName,
        userAvatarUrl: detail.userAvatarUrl?.trim() || undefined,
      },
    }),
  );
}

export function dispatchPreviewImage(src: string, alt?: string): void {
  const href = sanitizeHttpUrl(src);
  if (href == null) {
    return;
  }
  const caption = alt?.trim();
  window.dispatchEvent(
    new CustomEvent<FishpiPreviewImageDetail>(PREVIEW_IMAGE_EVENT, {
      detail: caption ? { src: href, alt: caption } : { src: href },
    }),
  );
}

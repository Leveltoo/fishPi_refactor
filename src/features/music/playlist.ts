type PlayHandler = (id: string) => void;
type RemoveHandler = (id: string) => void;
type HasHandler = (id: string) => boolean;

let handler: PlayHandler | null = null;
let removeHandler: RemoveHandler | null = null;
let hasHandler: HasHandler | null = null;

export function bindPlaylist(next: PlayHandler | null): void {
  handler = next;
}

export function bindPlaylistRemove(next: RemoveHandler | null): void {
  removeHandler = next;
}

export function bindPlaylistHas(next: HasHandler | null): void {
  hasHandler = next;
}

/**
 * 按当前播放模式处理一首网易云歌曲编号。
 * 播放器未挂载时返回 false，不抛错。
 */
export function playNeteaseSong(id: string): boolean {
  if (handler == null) {
    return false;
  }
  handler(id);
  return true;
}

/** 从播放列表移出指定歌曲；播放器未挂载返回 false。 */
export function removeNeteaseSong(id: string): boolean {
  if (removeHandler == null) {
    return false;
  }
  removeHandler(id);
  return true;
}

/** 列表里是否已有该曲。 */
export function playlistHasSong(id: string): boolean {
  if (hasHandler == null) {
    return false;
  }
  return hasHandler(id);
}

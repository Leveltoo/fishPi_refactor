/**
 * 网易云播放共享状态：PlaylistMount 持有 <audio>，顶栏音乐区只读订阅 + 发指令。
 * 对齐旧版 music.vue：无歌整段隐藏；关闭/上一首/歌名/下一首/播放暂停/移出。
 *
 * snapshot 必须缓存同一引用，否则 useSyncExternalStore 会无限重渲染。
 */

export type Track = {
  id: string;
  name: string;
  artist: string;
  url: string;
};

export type PlayerSnapshot = {
  tracks: Track[];
  index: number;
  mode: number;
  playing: boolean;
  error: string;
};

type Listener = () => void;

const listeners = new Set<Listener>();

const EMPTY_TRACKS: Track[] = [];

let tracks: Track[] = EMPTY_TRACKS;
let index = 0;
let mode = 0;
let playing = false;
let error = "";
let audio: HTMLAudioElement | null = null;
let cached: PlayerSnapshot = {
  tracks,
  index,
  mode,
  playing,
  error,
};

function sync(): void {
  cached = { tracks, index, mode, playing, error };
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getPlayerSnapshot(): PlayerSnapshot {
  return cached;
}

export function subscribePlayer(next: Listener): () => void {
  listeners.add(next);
  return () => {
    listeners.delete(next);
  };
}

export function setPlayerTracks(nextTracks: Track[], nextIndex: number): void {
  tracks = nextTracks;
  if (tracks.length === 0) {
    index = 0;
    playing = false;
  } else {
    index = Math.min(Math.max(0, nextIndex), tracks.length - 1);
  }
  sync();
}

export function setPlayerIndex(nextIndex: number): void {
  if (tracks.length === 0) {
    if (index !== 0) {
      index = 0;
      sync();
    }
    return;
  }
  const next = ((nextIndex % tracks.length) + tracks.length) % tracks.length;
  if (next === index) {
    return;
  }
  index = next;
  sync();
}

export function setPlayerMode(nextMode: number): void {
  if (nextMode === mode) {
    return;
  }
  mode = nextMode;
  sync();
}

export function setPlayerError(message: string): void {
  if (message === error) {
    return;
  }
  error = message;
  sync();
}

export function setPlayerPlaying(next: boolean): void {
  if (next === playing) {
    return;
  }
  playing = next;
  sync();
}

/** PlaylistMount 挂载/卸载 <audio> 时调用，顶栏才能真正控制播放。 */
export function bindPlayerAudio(element: HTMLAudioElement | null): void {
  audio = element;
  if (element == null && playing) {
    playing = false;
    sync();
  }
}

export function playerNext(): void {
  if (tracks.length < 2) {
    return;
  }
  setPlayerIndex(index + 1);
}

export function playerPrev(): void {
  if (tracks.length < 2) {
    return;
  }
  setPlayerIndex(index - 1);
}

/** 清空播放列表（旧版关闭按钮：playSongs = []）。 */
export function playerClear(): void {
  const hadSongs = tracks.length > 0 || error.length > 0 || playing;
  tracks = EMPTY_TRACKS;
  index = 0;
  playing = false;
  error = "";
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (hadSongs) {
    sync();
  }
}

/** 移出当前曲（旧版 trash）。 */
export function playerRemoveCurrent(): void {
  if (tracks.length === 0) {
    return;
  }
  const next = tracks.filter((_, itemIndex) => itemIndex !== index);
  if (next.length === 0) {
    playerClear();
    return;
  }
  tracks = next;
  if (index >= tracks.length) {
    index = 0;
  }
  sync();
}

export function playerTogglePlay(): void {
  if (audio == null || tracks.length === 0) {
    return;
  }
  if (playing) {
    audio.pause();
    return;
  }
  void audio.play().catch(() => {
    setPlayerPlaying(false);
    setPlayerError("这一首没有播起来");
  });
}

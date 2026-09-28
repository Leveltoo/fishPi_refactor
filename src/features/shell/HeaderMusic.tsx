import { useSyncExternalStore } from "react";
import { Pause, Play, SkipBack, SkipForward, Trash2, X } from "lucide-react";
import {
  getPlayerSnapshot,
  playerClear,
  playerNext,
  playerPrev,
  playerRemoveCurrent,
  playerTogglePlay,
  subscribePlayer,
} from "../music/playerStore";

function subscribe(next: () => void): () => void {
  return subscribePlayer(next);
}

/**
 * 顶栏音乐模块，对齐旧版 music.vue：
 * 无歌整段不显示；有歌时 关闭 / 上一首 / 歌名 / 下一首 / 播放暂停 / 移出。
 * 播放实体仍在 PlaylistMount 的 <audio>。
 */
export function HeaderMusic() {
  const player = useSyncExternalStore(
    subscribe,
    getPlayerSnapshot,
    getPlayerSnapshot,
  );
  const current = player.tracks[player.index];
  if (player.tracks.length === 0 || !current) {
    return null;
  }

  const multi = player.tracks.length > 1;

  return (
    <div
      className="shell__header-slot shell__header-slot--desk shell__header-music"
      data-menu="true"
      title={`${current.artist} - ${current.name}`}
    >
      <button
        type="button"
        className="shell__header-icon-btn"
        title="关闭播放器"
        aria-label="关闭播放器"
        onClick={() => playerClear()}
      >
        <X />
      </button>
      <button
        type="button"
        className="shell__header-icon-btn"
        title="上一首"
        aria-label="上一首"
        disabled={!multi}
        onClick={() => playerPrev()}
      >
        <SkipBack />
      </button>
      <span className="shell__header-music-name">
        {current.artist} - {current.name}
      </span>
      <button
        type="button"
        className="shell__header-icon-btn"
        title="下一首"
        aria-label="下一首"
        disabled={!multi}
        onClick={() => playerNext()}
      >
        <SkipForward />
      </button>
      <button
        type="button"
        className="shell__header-icon-btn"
        title={player.playing ? "暂停" : "播放"}
        aria-label={player.playing ? "暂停" : "播放"}
        onClick={() => playerTogglePlay()}
      >
        {player.playing ? <Pause /> : <Play />}
      </button>
      <button
        type="button"
        className="shell__header-icon-btn"
        title="移出播放列表"
        aria-label="移出播放列表"
        onClick={() => playerRemoveCurrent()}
      >
        <Trash2 />
      </button>
    </div>
  );
}

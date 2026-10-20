import { useState, useSyncExternalStore } from "react";
import {
  getPlayerSnapshot,
  playerClear,
  playerNext,
  playerPrev,
  playerRemoveCurrent,
  playerToggleMute,
  playerTogglePlay,
  subscribePlayer,
} from "../music/playerStore";

function subscribe(next: () => void): () => void {
  return subscribePlayer(next);
}

/**
 * 顶栏音乐模块，对齐旧版 music.vue：
 * 无歌整段不显示；有歌时 关闭 / 上一首 / 歌名 / 下一首 / 播放暂停 / 静音 / 移出。
 * 窄窗收成按钮。播放实体仍在 PlaylistMount 的 <audio>。
 */
export function HeaderMusic() {
  const player = useSyncExternalStore(
    subscribe,
    getPlayerSnapshot,
    getPlayerSnapshot,
  );
  const [expanded, setExpanded] = useState(false);
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
        className={
          expanded
            ? "shell__header-icon-btn shell__header-music-toggle is-on"
            : "shell__header-icon-btn shell__header-music-toggle"
        }
        title={current.artist}
        aria-label="展开播放器"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <i className="fa fa-music" aria-hidden="true" />
      </button>
      <span
        className={
          expanded
            ? "shell__header-music-player is-open"
            : "shell__header-music-player"
        }
      >
        <button
          type="button"
          className="shell__header-icon-btn"
          title="关闭播放器"
          aria-label="关闭播放器"
          onClick={() => playerClear()}
        >
          <i className="fa fa-times" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shell__header-icon-btn"
          title="上一首"
          aria-label="上一首"
          disabled={!multi}
          onClick={() => playerPrev()}
        >
          <i className="fa fa-backward" aria-hidden="true" />
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
          <i className="fa fa-forward" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shell__header-icon-btn"
          title={player.playing ? "暂停" : "播放"}
          aria-label={player.playing ? "暂停" : "播放"}
          onClick={() => playerTogglePlay()}
        >
          <i className={player.playing ? "fa fa-pause" : "fa fa-play"} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shell__header-icon-btn"
          title={player.muted ? "取消静音" : "静音"}
          aria-label={player.muted ? "取消静音" : "静音"}
          onClick={() => playerToggleMute()}
        >
          <i className={player.muted ? "fa fa-volume-off" : "fa fa-volume-up"} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shell__header-icon-btn"
          title="移出播放列表"
          aria-label="移出播放列表"
          onClick={() => playerRemoveCurrent()}
        >
          <i className="fa fa-trash-o" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

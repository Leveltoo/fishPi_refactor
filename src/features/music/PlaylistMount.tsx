import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { commandError, desktopPrefsGet, desktopPrefsSet } from "../desktop/api";
import { musicResolve } from "./api";
import { bindPlaylist, bindPlaylistHas, bindPlaylistRemove } from "./playlist";
import {
  bindPlayerAudio,
  enqueuePlayerTrack,
  getPlayerGeneration,
  getPlayerSnapshot,
  playerClear,
  playerNext,
  playerOnEnded,
  playerPrev,
  playerRemoveCurrent,
  playerRemoveSong,
  setPlayerError,
  setPlayerIndex,
  setPlayerMode,
  setPlayerPlaying,
  subscribePlayer,
  type Track,
} from "./playerStore";
import { MUSIC_MODE_OPTIONS } from "./modes";
import "../desktop/panel.css";

function subscribe(next: () => void): () => void {
  return subscribePlayer(next);
}

function getSnapshot(): ReturnType<typeof getPlayerSnapshot> {
  return getPlayerSnapshot();
}

function getServerSnapshot(): ReturnType<typeof getPlayerSnapshot> {
  return getPlayerSnapshot();
}

/**
 * 网易云列表播放。地址与旧版 main.js 相同，只播放，不下载。
 * 播放状态在 playerStore，顶栏音乐区共享同一份状态。
 */
export function PlaylistMount() {
  const player = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { tracks, index, mode, error } = player;
  const [songId, setSongId] = useState("");
  const pending = useRef(Promise.resolve());
  // 稳定 ref：内联箭头每次渲染都会 detach/attach，触发 bind(null) 循环
  const audioRef = useCallback((element: HTMLAudioElement | null) => {
    bindPlayerAudio(element);
  }, []);

  useEffect(() => {
    let alive = true;
    void desktopPrefsGet()
      .then((prefs) => {
        if (alive) {
          setPlayerMode(prefs.musicMode);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setPlayerError(commandError(err));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    bindPlaylist((id, forceAdd) => {
      void enqueue(id, forceAdd ? 1 : getPlayerSnapshot().mode);
    });
    bindPlaylistRemove(playerRemoveSong);
    bindPlaylistHas((id) => getPlayerSnapshot().tracks.some((item) => item.id === id));
    return () => {
      bindPlaylist(null);
      bindPlaylistRemove(null);
      bindPlaylistHas(null);
      playerClear();
    };
  }, []);

  function enqueue(id: string, nextMode: number): Promise<void> {
    const generation = getPlayerGeneration();
    const task = pending.current.then(async () => {
      if (generation !== getPlayerGeneration()) {
        return;
      }
      setPlayerError("");
      try {
        const song = await musicResolve(id);
        if (generation === getPlayerGeneration()) {
          const track: Track = {
            id: song.id,
            name: song.name,
            artist: song.artist,
            url: song.url,
          };
          enqueuePlayerTrack(track, nextMode);
        }
      } catch (err: unknown) {
        if (generation === getPlayerGeneration()) {
          setPlayerError(commandError(err));
        }
      }
    });
    pending.current = task;
    return task;
  }

  async function changeMode(next: number): Promise<void> {
    const previous = getPlayerSnapshot().mode;
    setPlayerMode(next);
    setPlayerError("");
    try {
      const prefs = await desktopPrefsSet({ musicMode: next });
      setPlayerMode(prefs.musicMode);
    } catch (err: unknown) {
      if (getPlayerSnapshot().mode === next) {
        setPlayerMode(previous);
      }
      setPlayerError(commandError(err));
    }
  }

  const current = tracks[index];

  return (
    <section className="parity-panel" aria-label="网易云播放列表">
      <section className="parity-section">
        <h2>网易云</h2>
        <label className="parity-row">
          播放方式
          <select
            value={String(mode)}
            onChange={(event) => void changeMode(Number(event.target.value))}
          >
            {MUSIC_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="parity-row">
          <input
            inputMode="numeric"
            aria-label="歌曲编号"
            value={songId}
            placeholder="歌曲编号"
            onChange={(event) =>
              setSongId(event.target.value.replace(/\D/g, "").slice(0, 20))
            }
          />
          <button
            type="button"
            disabled={!songId}
            onClick={() => void enqueue(songId, mode)}
          >
            按当前方式播放
          </button>
        </div>
        {tracks.length === 0 ? (
          <p className="parity-note">播放列表是空的。</p>
        ) : null}
        {current ? (
          <>
            <p className="parity-note">
              {current.artist} - {current.name}
            </p>
            <div className="parity-row">
              <button
                type="button"
                disabled={tracks.length < 2}
                onClick={() => playerPrev()}
              >
                上一首
              </button>
              <button
                type="button"
                disabled={tracks.length < 2}
                onClick={() => playerNext()}
              >
                下一首
              </button>
              <button type="button" onClick={() => playerRemoveCurrent()}>
                移出
              </button>
              <button type="button" onClick={() => playerClear()}>
                关闭
              </button>
            </div>
            <audio
              key={current.id}
              ref={audioRef}
              src={current.url}
              controls
              autoPlay
              muted={player.muted}
              playsInline
              onPlay={() => setPlayerPlaying(true)}
              onPause={() => setPlayerPlaying(false)}
              onEnded={() => playerOnEnded()}
              onError={() => setPlayerError("这一首没有播起来")}
            />
          </>
        ) : null}
        <ul className="parity-list">
          {tracks.map((track, itemIndex) => (
            <li key={track.id}>
              <button
                type="button"
                onClick={() => setPlayerIndex(itemIndex)}
              >
                {itemIndex === index ? "正在播放" : "播放"} {track.artist} -{" "}
                {track.name}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {error ? <p className="parity-error">{error}</p> : null}
    </section>
  );
}

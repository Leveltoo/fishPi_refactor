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
  getPlayerSnapshot,
  playerClear,
  playerNext,
  playerPrev,
  playerRemoveCurrent,
  setPlayerError,
  setPlayerIndex,
  setPlayerMode,
  setPlayerPlaying,
  setPlayerTracks,
  subscribePlayer,
  type Track,
} from "./playerStore";
import "../desktop/panel.css";

const MODE_LABEL: Record<number, string> = {
  0: "点击播放",
  1: "点击播放并加入播放列表",
  2: "点击加入播放列表",
};

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
  const { tracks, index, mode, playing, error } = player;
  const [songId, setSongId] = useState("");
  const tracksRef = useRef(tracks);
  const indexRef = useRef(index);
  const modeRef = useRef(mode);
  tracksRef.current = tracks;
  indexRef.current = index;
  modeRef.current = mode;
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
    bindPlaylist((id) => {
      void enqueue(id, modeRef.current);
    });
    bindPlaylistRemove((id) => {
      const current = tracksRef.current;
      const next = current.filter((item) => item.id !== id);
      if (next.length === current.length) {
        return;
      }
      if (next.length === 0) {
        playerClear();
        return;
      }
      const nextIndex =
        indexRef.current >= next.length ? 0 : indexRef.current;
      setPlayerTracks(next, nextIndex);
    });
    bindPlaylistHas((id) => tracksRef.current.some((item) => item.id === id));
    return () => {
      bindPlaylist(null);
      bindPlaylistRemove(null);
      bindPlaylistHas(null);
    };
  }, []);

  async function enqueue(id: string, nextMode: number): Promise<void> {
    setPlayerError("");
    try {
      const song = await musicResolve(id);
      const track: Track = {
        id: song.id,
        name: song.name,
        artist: song.artist,
        url: song.url,
      };
      const current = tracksRef.current;
      if (nextMode === 0) {
        setPlayerTracks([track], 0);
        return;
      }
      const exists = current.some((item) => item.id === track.id);
      const next = exists ? current : [...current, track];
      if (nextMode === 2) {
        const playIndex = Math.max(
          0,
          exists
            ? current.findIndex((item) => item.id === track.id)
            : next.length - 1,
        );
        setPlayerTracks(next, exists ? indexRef.current : playIndex);
        return;
      }
      setPlayerTracks(
        next,
        indexRef.current >= next.length ? 0 : indexRef.current,
      );
    } catch (err: unknown) {
      setPlayerError(commandError(err));
    }
  }

  async function changeMode(next: number): Promise<void> {
    setPlayerMode(next);
    setPlayerError("");
    try {
      const prefs = await desktopPrefsSet({ musicMode: next });
      setPlayerMode(prefs.musicMode);
    } catch (err: unknown) {
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
            <option value="0">{MODE_LABEL[0]}</option>
            <option value="2">{MODE_LABEL[2]}</option>
            <option value="1">{MODE_LABEL[1]}</option>
          </select>
        </label>
        <div className="parity-row">
          <input
            inputMode="numeric"
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
              onPlay={() => setPlayerPlaying(true)}
              onPause={() => setPlayerPlaying(false)}
              onEnded={() => {
                if (tracks.length > 1) {
                  setPlayerIndex((index + 1) % tracks.length);
                } else {
                  setPlayerPlaying(false);
                }
              }}
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

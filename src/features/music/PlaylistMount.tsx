import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { commandError, desktopPrefsGet, desktopPrefsSet } from "../desktop/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  playerToggleMute,
  playerTogglePlay,
  subscribePlayer,
  type Track,
} from "./playerStore";
import { MUSIC_MODE_OPTIONS } from "./modes";
import "./music.css";

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
    <section className="legacy-music" aria-label="网易云播放列表">
      <header className="legacy-music-head">
        <span><i className="fa fa-music" aria-hidden="true" /> 网易云</span>
        <Select
          value={String(mode)}
          onValueChange={(value) => void changeMode(Number(value))}
        >
          <SelectTrigger className="legacy-music-select" size="sm" aria-label="播放方式">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="legacy-music-options">
            {MUSIC_MODE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      <div className="legacy-music-add">
        <Input
          className="legacy-music-input"
          inputMode="numeric"
          aria-label="歌曲编号"
          value={songId}
          placeholder="歌曲编号"
          onChange={(event) =>
            setSongId(event.target.value.replace(/\D/g, "").slice(0, 20))
          }
        />
        <Button
          type="button"
          size="xs"
          disabled={!songId}
          onClick={() => void enqueue(songId, mode)}
        >
          播放
        </Button>
      </div>

      {current ? (
        <section className="legacy-music-player">
          <div className="legacy-music-player-row">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="关闭播放器"
              aria-label="关闭播放器"
              onClick={() => playerClear()}
            >
              <i className="fa fa-times" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="上一首"
              aria-label="上一首"
              disabled={tracks.length < 2}
              onClick={() => playerPrev()}
            >
              <i className="fa fa-backward" aria-hidden="true" />
            </Button>
            <span className="legacy-music-name">
              {current.artist} - {current.name}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="下一首"
              aria-label="下一首"
              disabled={tracks.length < 2}
              onClick={() => playerNext()}
            >
              <i className="fa fa-forward" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={player.playing ? "暂停" : "播放"}
              aria-label={player.playing ? "暂停" : "播放"}
              onClick={() => playerTogglePlay()}
            >
              <i className={player.playing ? "fa fa-pause" : "fa fa-play"} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title={player.muted ? "取消静音" : "静音"}
              aria-label={player.muted ? "取消静音" : "静音"}
              onClick={() => playerToggleMute()}
            >
              <i
                className={player.muted ? "fa fa-volume-off" : "fa fa-volume-up"}
                aria-hidden="true"
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="移出播放列表"
              aria-label="移出播放列表"
              onClick={() => playerRemoveCurrent()}
            >
              <i className="fa fa-trash-o" aria-hidden="true" />
            </Button>
          </div>
          <audio
            className="legacy-music-audio"
            key={current.id}
            ref={audioRef}
            src={current.url}
            autoPlay
            muted={player.muted}
            playsInline
            onPlay={() => setPlayerPlaying(true)}
            onPause={() => setPlayerPlaying(false)}
            onEnded={() => playerOnEnded()}
            onError={() => setPlayerError("这一首没有播起来")}
          />
        </section>
      ) : null}

      <ScrollArea className="legacy-music-scroll">
        <ul className="legacy-music-list">
          {tracks.map((track, itemIndex) => (
            <li key={track.id} className={itemIndex === index ? "is-playing" : undefined}>
              <Button
                type="button"
                variant="ghost"
                className="legacy-music-track"
                onClick={() => setPlayerIndex(itemIndex)}
              >
                <i
                  className={itemIndex === index ? "fa fa-volume-up" : "fa fa-music"}
                  aria-hidden="true"
                />
                <span>{track.artist} - {track.name}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="移出播放列表"
                aria-label={`移出 ${track.name}`}
                onClick={() => playerRemoveSong(track.id)}
              >
                <i className="fa fa-times" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      </ScrollArea>

      {error ? <p className="legacy-music-error">{error}</p> : null}
    </section>
  );
}

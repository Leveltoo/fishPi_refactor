import { invoke } from "@tauri-apps/api/core";

export type SongInfo = {
  id: string;
  name: string;
  artist: string;
  cover: string;
  url: string;
};

export function musicResolve(id: string): Promise<SongInfo> {
  return invoke<SongInfo>("music_resolve", { id });
}

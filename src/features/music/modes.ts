/**
 * 网易云点击策略。数值与旧版 `setting.global.music` 一致。
 * 旧版 1/2 的文案对调也保持：1 的文案是「播放并加入」，实际只加入；
 * 2 的文案是「加入列表」，实际会切到刚加入的那首。
 */
export const MUSIC_MODE_OPTIONS = [
  { value: 0, label: "点击播放" },
  { value: 2, label: "点击加入播放列表" },
  { value: 1, label: "点击播放并加入播放列表" },
] as const;

export function clampMusicMode(value: number): 0 | 1 | 2 {
  if (value === 1 || value === 2) {
    return value;
  }
  return 0;
}

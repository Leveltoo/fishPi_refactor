let shared: AudioContext | null = null;

/** 本地短提示音。失败时静默，不引入音频依赖。 */
export function playNoticeSound(): void {
  const Context = window.AudioContext;
  if (!Context) {
    return;
  }
  try {
    shared ??= new Context();
    const now = shared.currentTime;
    const tone = shared.createOscillator();
    const gain = shared.createGain();
    tone.type = "sine";
    tone.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.05, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    tone.connect(gain);
    gain.connect(shared.destination);
    tone.start(now);
    tone.stop(now + 0.18);
  } catch {
    shared = null;
  }
}

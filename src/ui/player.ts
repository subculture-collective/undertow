import { create } from 'zustand';

/** One <audio> element drives preview playback; the render loop reads its clock directly. */
export const audioEl = new Audio();
audioEl.preload = 'auto';

let idleStart = performance.now();

interface PlayerState {
  playing: boolean;
  time: number;
  duration: number;
  loop: boolean;
  setSource: (url: string | null) => void;
  toggle: () => void;
  seek: (t: number) => void;
  setLoop: (v: boolean) => void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  playing: false,
  time: 0,
  duration: 0,
  loop: true,
  setSource: (url) => {
    audioEl.pause();
    if (url) audioEl.src = url; else audioEl.removeAttribute('src');
    set({ playing: false, time: 0, duration: 0 });
  },
  toggle: () => {
    if (!audioEl.src) { set({ playing: !get().playing }); idleStart = performance.now() - get().time * 1000; return; }
    if (audioEl.paused) void audioEl.play(); else audioEl.pause();
  },
  seek: (t) => {
    if (audioEl.src) audioEl.currentTime = t;
    idleStart = performance.now() - t * 1000;
    set({ time: t });
  },
  setLoop: (loop) => { audioEl.loop = loop; set({ loop }); },
}));
audioEl.loop = true;

audioEl.addEventListener('play', () => usePlayer.setState({ playing: true }));
audioEl.addEventListener('pause', () => usePlayer.setState({ playing: false }));
audioEl.addEventListener('loadedmetadata', () => usePlayer.setState({ duration: audioEl.duration }));

/** Current playback time; without a song, a free-running clock while "playing". */
export function currentTime(): number {
  if (audioEl.src) return audioEl.currentTime;
  const s = usePlayer.getState();
  return s.playing ? (performance.now() - idleStart) / 1000 : s.time;
}

export const fmtTime = (t: number) => {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

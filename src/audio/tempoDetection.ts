import { useEffect } from 'react';
import { create } from 'zustand';
import { useStore } from '../store';
import type { AudioTrack } from './analysis';
import type { TempoEstimate } from './tempo';

type Status = 'running' | 'done' | 'none' | 'failed';

/** Detection state per song asset, for the inspector. */
export const useTempoStatus = create<Record<string, Status>>(() => ({}));

const results = new WeakMap<AudioTrack, Promise<TempoEstimate | null>>();

/** Estimates a song's tempo in a worker, once per decoded track. */
export function detectTrackTempo(track: AudioTrack): Promise<TempoEstimate | null> {
  let p = results.get(track);
  if (!p) {
    p = new Promise<TempoEstimate | null>((resolve, reject) => {
      const b = track.buffer, len = b.length, mono = new Float32Array(len);
      for (let c = 0; c < b.numberOfChannels; c++) {
        const ch = b.getChannelData(c);
        for (let i = 0; i < len; i++) mono[i] += ch[i] / b.numberOfChannels;
      }
      const worker = new Worker(new URL('./tempo.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: TempoEstimate | null; error?: string }>) => {
        worker.terminate();
        if (e.data.ok) resolve(e.data.result ?? null); else reject(new Error(e.data.error));
      };
      worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'tempo worker failed')); };
      worker.postMessage({ mono, sampleRate: b.sampleRate }, [mono.buffer]);
    });
    results.set(track, p);
  }
  return p;
}

/**
 * Detects the tempo of the project's song in the background whenever the song
 * has no tempo yet, or its saved tempo belongs to a different song. The result
 * is stored without an undo step; a tempo edited by hand is never replaced.
 */
export function useTempoDetection() {
  const audioId = useStore((s) => s.project.audioAssetId);
  const track = useStore((s) => (audioId ? s.assets[audioId]?.track : undefined));
  const tempoFor = useStore((s) => s.project.tempo?.audioAssetId);
  const needed = !!audioId && !!track && tempoFor !== audioId;
  useEffect(() => {
    if (!needed || !audioId || !track) return;
    let live = true;
    useTempoStatus.setState({ [audioId]: 'running' });
    detectTrackTempo(track).then((est) => {
      useTempoStatus.setState({ [audioId]: est ? 'done' : 'none' });
      const s = useStore.getState();
      if (!live || !est || s.project.audioAssetId !== audioId || s.project.tempo?.audioAssetId === audioId) return;
      s.setTempo({ bpm: est.bpm, offset: est.offset, confidence: est.confidence, audioAssetId: audioId, manual: false }, false);
    }).catch((e) => {
      console.warn('Tempo detection failed:', e);
      useTempoStatus.setState({ [audioId]: 'failed' });
    });
    return () => { live = false; };
  }, [needed, audioId, track]);
}

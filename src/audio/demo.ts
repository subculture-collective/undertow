import { AudioTrack } from './analysis';

/**
 * A few seconds of synthesized music at 120 bpm (kick, bass, a minor chord
 * and hi-hats), so template thumbnails and self-tests have something to react to.
 */
export function demoTrack(seconds = 4, sampleRate = 44100): AudioTrack {
  const n = Math.round(seconds * sampleRate);
  const buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate });
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const beat = 0.5;
  const chord = [220, 261.63, 329.63]; // A minor
  let seed = 1;
  const noise = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2147483648) - 1;
  let kickPhase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate, tb = t % beat, th = (t + beat / 2) % beat;
    // Kick: a pitch-swept sine with a fast decay.
    kickPhase += (2 * Math.PI * (45 + 90 * Math.exp(-tb * 30))) / sampleRate;
    const kick = Math.sin(kickPhase) * Math.exp(-tb * 9) * 0.9;
    const bass = Math.sin(2 * Math.PI * 55 * t) * 0.25 * (1 - Math.exp(-tb * 20)) * Math.exp(-tb * 2);
    let pad = 0;
    for (const f of chord) pad += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
    pad *= 0.06 * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t));
    const hat = noise() * Math.exp(-th * 60) * 0.18;
    L[i] = kick + bass + pad * 1.1 + hat * 0.7;
    R[i] = kick + bass + pad * 0.9 + hat * 1.2;
  }
  return new AudioTrack(buf);
}

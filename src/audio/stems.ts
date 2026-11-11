import type { AudioTrack } from './analysis';
import type { Layer, LayerType, StemId, StemSource } from '../types';

export type { StemId, StemSource };

/** Separated parts of a song, in the order the model returns them. */
export const STEM_IDS = ['drums', 'bass', 'other', 'vocals'] as const satisfies readonly StemId[];
export const STEM_SOURCES: readonly (readonly [StemSource, string])[] = [
  ['mix', 'Whole song'], ['drums', 'Drums'], ['bass', 'Bass'], ['vocals', 'Vocals'], ['other', 'Other instruments'],
];

export type StemTracks = Record<StemId, AudioTrack>;

/**
 * The separation model: Open-Unmix UMX-HQ (MIT-licensed weights from the
 * authors' Zenodo record 3370489), four targets in one ONNX graph, int8.
 * `scripts/stems/export-umxhq.py` rebuilds the file byte for byte.
 *
 * Where it is served from is a deployment decision; this is the only place
 * that names it. A same-origin path needs the file at public/models/.
 */
export const STEM_MODEL = {
  id: 'umxhq-int8-v1',
  url: '/models/umxhq-int8.onnx',
  bytes: 35_903_087,
  sha256: '212eaaa684c8fe8c18f8666d6d05cde1ce8766d8c55d300896d28d950092691d',
  sampleRate: 44100,
} as const;
/** onnxruntime-web's WebAssembly runtime (ort-wasm-simd-threaded.wasm 1.30.0), fetched with the model. */
export const STEM_RUNTIME_BYTES = 14_239_897;

/** Layer types that react to the audio and so can follow a stem. */
export const REACTIVE_TYPES: readonly LayerType[] = ['video', 'particles', 'milkdrop', 'image', 'waveform', 'spectrum', 'vu'];
export const isReactive = (type: LayerType) => REACTIVE_TYPES.includes(type);

/** The layer's chosen source. Layers saved before stems existed, and unknown values, mean the whole song. */
export function layerSource(layer: Layer): StemSource {
  if (!isReactive(layer.type)) return 'mix';
  const s = (layer.props as { source?: unknown }).source;
  return typeof s === 'string' && (STEM_IDS as readonly string[]).includes(s) ? (s as StemId) : 'mix';
}

/**
 * The track a layer should analyse: its stem when the song has been separated,
 * otherwise the mix. `fallback` is true when a stem was asked for but is missing.
 */
export function pickTrack<T>(source: StemSource, mix: T, stems: Record<StemId, T> | undefined): { track: T; stem: StemId | null; fallback: boolean } {
  if (source === 'mix') return { track: mix, stem: null, fallback: false };
  const t = stems?.[source];
  return t ? { track: t, stem: source, fallback: false } : { track: mix, stem: null, fallback: true };
}

/**
 * Stems as saved in IndexedDB under the song's asset id. Each stem is one Blob
 * of 16-bit PCM, left channel then right: Blobs are stored outside the record,
 * which Chrome otherwise caps at about 133 MB (a four-minute song's stems are more).
 */
export interface StoredStems {
  model: string;
  sampleRate: number;
  length: number;
  stems: Record<StemId, Blob>;
}

/** IndexedDB key for a song's stems. One entry per song; a new model replaces it. */
export const stemsKey = (audioAssetId: string) => audioAssetId;

/** Packs one stem's two channels into the Blob that is stored. */
export const stemBlob = (left: Int16Array, right: Int16Array) => new Blob([left as Int16Array<ArrayBuffer>, right as Int16Array<ArrayBuffer>]);

/** Unpacks a stored stem into its two channels. */
export async function stemChannels(blob: Blob, length: number): Promise<[Int16Array, Int16Array]> {
  const buf = await blob.arrayBuffer();
  return [new Int16Array(buf, 0, length), new Int16Array(buf, length * 2, length)];
}

/** Whether saved stems belong to this model and to a song of this length and rate; otherwise separation runs again. */
export function storedStemsUsable(row: unknown, song: { sampleRate: number; length: number }, model = STEM_MODEL.id): row is StoredStems {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Partial<StoredStems>;
  if (r.model !== model || r.sampleRate !== song.sampleRate || r.length !== song.length || !r.stems) return false;
  return STEM_IDS.every((id) => r.stems![id] instanceof Blob && r.stems![id].size === song.length * 4);
}

/** Total download before the first separation, for the button label. */
export const stemDownloadMB = () => Math.round((STEM_MODEL.bytes + STEM_RUNTIME_BYTES) / 1e6);

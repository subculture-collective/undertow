/**
 * Media references. Projects saved to an account store the layout only; the
 * songs, images, clips and fonts stay on each device. A project carries a
 * manifest of the files it uses, so another device can find or ask for them.
 */
import { fontFamily, type RuntimeAsset } from '../assets';
import type { Schemas } from '../api/client';
import type { AssetKind, Layer, Project } from '../types';

export type MediaRef = Schemas['MediaRef'];

const FONT_PREFIX = fontFamily('');

/** Every asset id the project refers to: the song, layer files and uploaded fonts. */
export function referencedIds(p: Project): Set<string> {
  const ids = new Set<string>();
  if (p.audioAssetId) ids.add(p.audioAssetId);
  for (const l of p.layers) {
    const props = l.props as { assetId?: string | null; font?: string };
    if (props.assetId) ids.add(props.assetId);
    if (props.font?.startsWith(FONT_PREFIX)) ids.add(props.font.slice(FONT_PREFIX.length));
  }
  return ids;
}

/**
 * The manifest to save: files present here, plus entries from the previous
 * manifest for files still referenced but missing on this device, so their
 * names aren't forgotten.
 */
export function buildManifest(p: Project, assets: Record<string, RuntimeAsset>, previous: MediaRef[] = []): MediaRef[] {
  const prev = new Map(previous.map((m) => [m.id, m]));
  const out: MediaRef[] = [];
  for (const id of referencedIds(p)) {
    const a = assets[id];
    if (a) out.push({ id, kind: a.meta.kind, name: a.meta.name, size: a.blob.size });
    else if (prev.has(id)) out.push(prev.get(id)!);
  }
  return out;
}

/** Points every reference to `from` at `to`. */
export function remapAsset(p: Project, from: string, to: string): Project {
  const layers = p.layers.map((l) => {
    const props = l.props as unknown as Record<string, unknown>;
    if (props.assetId === from) return { ...l, props: { ...props, assetId: to } } as unknown as Layer;
    if (props.font === fontFamily(from)) return { ...l, props: { ...props, font: fontFamily(to) } } as unknown as Layer;
    return l;
  });
  return { ...p, audioAssetId: p.audioAssetId === from ? to : p.audioAssetId, layers };
}

/**
 * Relinks missing files to ones already on this device with the same kind and
 * name (and size, when both are known). Returns the updated project and the
 * references that are still missing.
 */
export function autoRelink(p: Project, manifest: MediaRef[], assets: Record<string, RuntimeAsset>) {
  let project = p;
  const missing: MediaRef[] = [];
  const byId = new Map(manifest.map((m) => [m.id, m]));
  for (const id of referencedIds(p)) {
    if (assets[id]) continue;
    const ref = byId.get(id);
    if (!ref) { missing.push({ id, kind: 'image', name: 'Unknown file' }); continue; }
    const match = Object.values(assets).find((a) => a.meta.kind === ref.kind && a.meta.name === ref.name
      && (ref.size === undefined || a.blob.size === ref.size));
    if (match) project = remapAsset(project, id, match.meta.id);
    else missing.push(ref);
  }
  return { project, missing };
}

export const KIND_LABEL: Record<AssetKind, string> = { audio: 'Song', image: 'Image', video: 'Video clip', lyrics: 'Lyrics', font: 'Font' };

import { expect, it } from 'vitest';
import type { RuntimeAsset } from '../src/assets';
import { createLayer, starterProject, videoBackgroundIndex } from '../src/defaults';
import { applyTemplate, TEMPLATES } from '../src/templates';
import type { Layer, Project } from '../src/types';

const asset = (id: string, kind: string) => ({ meta: { id, kind, name: id, mime: '' }, blob: new Blob(), url: '' }) as unknown as RuntimeAsset;
const assets = Object.fromEntries([asset('art', 'image'), asset('logo', 'image'), asset('clip', 'video'), asset('words', 'lyrics')].map((a) => [a.meta.id, a]));
const withAsset = (type: 'image' | 'video' | 'lyrics', assetId: string) => {
  const l = createLayer(type) as Layer & { props: { assetId: string | null } };
  l.props.assetId = assetId;
  l.rects.landscape = { x: 0.7, y: 0.1, w: 0.2, h: 0.2 };
  return l;
};
const current: Project = { ...starterProject(), layers: [withAsset('video', 'clip'), withAsset('image', 'art'), withAsset('image', 'logo'), withAsset('lyrics', 'words')] };
const assetIds = (p: Project) => p.layers.map((l) => (l.props as { assetId?: string | null }).assetId).filter(Boolean);

it.each(TEMPLATES.map((t) => [t.id, t] as const))('keeps every piece of media when applying %s', (_, t) => {
  const next = applyTemplate(t, current, assets);
  expect(assetIds(next).sort()).toEqual(['art', 'clip', 'logo', 'words']);
  const templateTypes = new Set(t.build().layers.map((l) => l.type));
  for (const l of next.layers) {
    const id = (l.props as { assetId?: string | null }).assetId;
    if (!id) continue;
    const original = current.layers.find((c) => (c.props as { assetId?: string | null }).assetId === id)!;
    const carried = !templateTypes.has(l.type) || id === 'logo';
    if (carried) {
      expect(l.visible, `${id} is hidden`).toBe(false);
      expect(l.rects).toEqual(original.rects);
      expect(l.id).not.toBe(original.id);
    }
  }
  const clip = next.layers.findIndex((l) => l.type === 'video');
  if (!templateTypes.has('video')) expect(clip).toBe(videoBackgroundIndex(next.layers.filter((l) => l.type !== 'video')));
});

it('carries hidden media over again on the next template', () => {
  const [a, b] = TEMPLATES.filter((t) => !t.build().layers.some((l) => l.type === 'video'));
  const twice = applyTemplate(b, applyTemplate(a, current, assets), assets);
  expect(assetIds(twice).sort()).toEqual(['art', 'clip', 'logo', 'words']);
});

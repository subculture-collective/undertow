import { expect, it } from 'vitest';
import { starterProject } from '../src/defaults';
import { toProject } from '../src/projectShape';

it('rejects files that are not layouts', () => {
  for (const x of [null, 42, 'x', [], { name: 'x' }, { layers: 'nope' }]) expect(toProject(x)).toBeNull();
});

it('passes a real project through unchanged in substance', () => {
  const p = starterProject();
  expect(toProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
});

it('fills missing rects, props and fields and drops unknown layer types', () => {
  const p = toProject({ name: 3, layers: [
    { id: 'a', type: 'text', rects: { landscape: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }, props: { text: 'hi' } },
    { id: 'b', type: 'hologram' },
    null,
  ] })!;
  expect(p.name).toBe('Untitled');
  expect(p.audioAssetId).toBeNull();
  expect(p.layers).toHaveLength(1);
  const [l] = p.layers;
  expect(l.rects.landscape).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
  expect(l.rects.portrait).toMatchObject({ x: expect.any(Number), w: expect.any(Number) });
  expect(l.type === 'text' && l.props.text).toBe('hi');
  expect(l.type === 'text' && typeof l.props.weight).toBe('number');
  expect(l.opacity).toBe(1);
});

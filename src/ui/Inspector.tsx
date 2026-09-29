import { useEffect, useMemo, useRef, useState } from 'react';
import { fontFamily, fontLabel } from '../assets';
import { getPresetNames, loadPresets } from '../render/milkdrop';
import { SOCIAL_ICONS } from '../render/icons';
import { useSelectedLayer, useStore } from '../store';
import {
  ASPECTS, ASPECT_IDS, BUILTIN_FONTS, type AssetKind, type BlendMode, type Layer, type ParticleStyle, type ParticlesProps,
  type SocialPlatform, type TextStyle,
} from '../types';
import { Color, NumberInput, Row, Select, Slider, Toggle } from './controls';

const BLENDS: [BlendMode, string][] = [
  ['source-over', 'Normal'], ['screen', 'Screen'], ['lighter', 'Add'], ['multiply', 'Multiply'],
  ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['difference', 'Difference'],
];
/** Switching particle style also picks a sensible direction and density for it. */
const PARTICLE_STYLES: Record<ParticleStyle, { label: string; preset: Partial<ParticlesProps> }> = {
  dust: { label: 'Floating dust', preset: { direction: 270, count: 160 } },
  bokeh: { label: 'Bokeh', preset: { direction: 300, count: 40 } },
  embers: { label: 'Rising embers', preset: { direction: 270, count: 120 } },
  snow: { label: 'Snow', preset: { direction: 95, count: 220 } },
  starfield: { label: 'Starfield warp', preset: { count: 350 } },
};
const pct = (v: number) => `${Math.round(v * 100)}%`;

function AssetPicker({ kind, value, onChange, accept }: { kind: AssetKind; value: string | null; onChange: (id: string | null) => void; accept: string }) {
  const assets = useStore((s) => s.assets);
  const importFiles = useStore((s) => s.importFiles);
  const input = useRef<HTMLInputElement>(null);
  const list = Object.values(assets).filter((a) => a.meta.kind === kind);
  return (
    <Row label={kind === 'image' ? 'Image' : kind === 'video' ? 'Clip' : 'File'}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— none —</option>
        {list.map((a) => <option key={a.meta.id} value={a.meta.id}>{a.meta.name}</option>)}
      </select>
      <button onClick={() => input.current?.click()}>Upload…</button>
      <input ref={input} type="file" accept={accept} hidden onChange={async (e) => {
        const [a] = await importFiles([...(e.target.files ?? [])]);
        if (a) onChange(a.meta.id);
        e.target.value = '';
      }} />
    </Row>
  );
}

function PresetPicker({ layerId, value, onChange }: { layerId: string; value: string; onChange: (v: string) => void }) {
  const [names, setNames] = useState(getPresetNames());
  const [q, setQ] = useState('');
  useEffect(() => { loadPresets().then(() => setNames(getPresetNames())); }, []);
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return s ? names.filter((n) => n.toLowerCase().includes(s)) : names;
  }, [names, q]);
  const idx = names.indexOf(value);
  const step = (d: number) => names.length && onChange(names[(idx + d + names.length) % names.length]);
  return (
    <div className="preset-picker" key={layerId}>
      <div className="preset-current" title={value || 'Random (from seed)'}>{value || 'Random (from seed)'}</div>
      <div className="preset-buttons">
        <button onClick={() => step(-1)}>◀ Prev</button>
        <button onClick={() => onChange(names[Math.floor(Math.random() * names.length)])}>Random</button>
        <button onClick={() => step(1)}>Next ▶</button>
      </div>
      <input placeholder={`Search ${names.length} presets…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="preset-list">
        {filtered.slice(0, 300).map((n) => (
          <div key={n} className={n === value ? 'active' : ''} onClick={() => onChange(n)}>{n}</div>
        ))}
      </div>
    </div>
  );
}

function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const assets = useStore((s) => s.assets);
  const importFiles = useStore((s) => s.importFiles);
  const input = useRef<HTMLInputElement>(null);
  const uploaded = Object.values(assets).filter((a) => a.meta.kind === 'font');
  const known = (BUILTIN_FONTS as readonly string[]).includes(value) || uploaded.some((a) => fontFamily(a.meta.id) === value);
  return (
    <Row label="Font">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Built in">
          {BUILTIN_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
        </optgroup>
        {uploaded.length > 0 && (
          <optgroup label="Uploaded">
            {uploaded.map((a) => <option key={a.meta.id} value={fontFamily(a.meta.id)}>{fontLabel(a)}</option>)}
          </optgroup>
        )}
        {!known && <option value={value}>Uploaded font (missing)</option>}
      </select>
      <button title="Upload a TTF, OTF, WOFF or WOFF2 font" onClick={() => input.current?.click()}>Upload…</button>
      <input ref={input} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={async (e) => {
        const [a] = await importFiles([...(e.target.files ?? [])]);
        if (a?.meta.kind === 'font') onChange(fontFamily(a.meta.id));
        e.target.value = '';
      }} />
    </Row>
  );
}

function TextStyleFields({ p, set, align = true }: { p: Partial<TextStyle>; set: (patch: Partial<TextStyle>) => void; align?: boolean }) {
  return <>
    <FontPicker value={p.font!} onChange={(font) => set({ font })} />
    <Select label="Weight" value={p.weight!} options={[[300, 'Light'], [400, 'Regular'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']] as const} onChange={(weight) => set({ weight })} />
    <Color label="Colour" value={p.color!} onChange={(color) => set({ color })} />
    {align && <Select label="Align" value={p.align!} options={['left', 'center', 'right'] as const} onChange={(a) => set({ align: a })} />}
    {p.uppercase !== undefined && <Toggle label="Uppercase" value={p.uppercase} onChange={(uppercase) => set({ uppercase })} />}
    <Slider label="Spacing" value={p.letterSpacing!} min={-0.05} max={0.5} onChange={(letterSpacing) => set({ letterSpacing })} />
    <Slider label="Shadow" value={p.shadow!} min={0} max={1} onChange={(shadow) => set({ shadow })} />
  </>;
}

function TypeFields({ layer }: { layer: Layer }) {
  const updateProps = useStore((s) => s.updateProps);
  const set = (patch: Record<string, unknown>) => updateProps(layer.id, patch);

  switch (layer.type) {
    case 'solid': {
      const p = layer.props;
      return <>
        <Color label="Colour" value={p.color} onChange={(color) => set({ color })} />
        <Toggle label="Gradient" value={p.gradient} onChange={(gradient) => set({ gradient })} />
        {p.gradient && <>
          <Color label="Colour 2" value={p.color2} onChange={(color2) => set({ color2 })} />
          <Slider label="Angle" value={p.angle} min={0} max={360} step={1} onChange={(angle) => set({ angle })} format={(v) => `${v}°`} />
        </>}
      </>;
    }
    case 'video': {
      const p = layer.props;
      return <VideoFields p={p} set={set} />;
    }
    case 'particles': {
      const p = layer.props;
      return <>
        <Select label="Style" value={p.style} options={Object.entries(PARTICLE_STYLES).map(([k, v]) => [k as ParticleStyle, v.label] as const)}
          onChange={(style) => set({ style, ...PARTICLE_STYLES[style].preset })} />
        <Slider label="Amount" value={p.count} min={10} max={600} step={1} onChange={(count) => set({ count })} />
        <Slider label="Size" value={p.size} min={0.25} max={4} onChange={(size) => set({ size })} format={(v) => `${v.toFixed(2)}×`} />
        <Slider label="Speed" value={p.speed} min={0} max={4} onChange={(speed) => set({ speed })} format={(v) => `${v.toFixed(2)}×`} />
        {p.style !== 'starfield' && <Slider label="Direction" value={p.direction} min={0} max={359} step={1} onChange={(direction) => set({ direction })} format={(v) => `${v}°`} />}
        <Color label="Colour" value={p.color} onChange={(color) => set({ color })} />
        <Color label="Colour 2" value={p.color2} onChange={(color2) => set({ color2 })} />
        <Slider label="Bass reaction" value={p.react} min={0} max={2} onChange={(react) => set({ react })} />
        <NumberInput label="Seed" value={p.seed} onChange={(seed) => set({ seed })} />
        <p className="hint">Particles follow the song's timing, so the export matches the preview. Screen or Add blending suits them best.</p>
      </>;
    }
    case 'milkdrop': {
      const p = layer.props;
      return <>
        <PresetPicker layerId={layer.id} value={p.preset} onChange={(preset) => set({ preset })} />
        <Slider label="Change every" value={p.cycle} min={0} max={120} step={1} onChange={(cycle) => set({ cycle })} format={(v) => (v ? `${v}s` : 'never')} />
        {p.cycle > 0 && <>
          <Slider label="Blend time" value={p.blendTime} min={0} max={10} step={0.1} onChange={(blendTime) => set({ blendTime })} format={(v) => `${v}s`} />
          <NumberInput label="Shuffle seed" value={p.seed} onChange={(seed) => set({ seed })} />
        </>}
        <Slider label="Reactivity" value={p.gain} min={0} max={3} onChange={(gain) => set({ gain })} />
      </>;
    }
    case 'image': {
      const p = layer.props;
      return <>
        <AssetPicker kind="image" value={p.assetId} accept="image/*,.svg" onChange={(assetId) => set({ assetId })} />
        <Select label="Fit" value={p.fit} options={['cover', 'contain', 'stretch'] as const} onChange={(fit) => set({ fit })} />
        <Toggle label="Circle" value={p.circle} onChange={(circle) => set({ circle })} />
        {!p.circle && <Slider label="Corner radius" value={p.radius} min={0} max={0.5} onChange={(radius) => set({ radius })} format={pct} />}
        <Slider label="Shadow" value={p.shadow} min={0} max={1} onChange={(shadow) => set({ shadow })} />
        <Slider label="Bass pulse" value={p.pulse} min={0} max={2} onChange={(pulse) => set({ pulse })} />
        <Slider label="Spin (rpm)" value={p.spin} min={-45} max={45} step={0.5} onChange={(spin) => set({ spin })} />
      </>;
    }
    case 'text': {
      const p = layer.props;
      return <>
        <Row label="Text"><textarea rows={3} value={p.text} onChange={(e) => set({ text: e.target.value })} /></Row>
        <TextStyleFields p={p} set={set} />
        <p className="hint">Text scales to fill its box. Resize the box to change the size.</p>
      </>;
    }
    case 'lyrics': {
      const p = layer.props;
      return <>
        <AssetPicker kind="lyrics" value={p.assetId} accept=".lrc,.srt,.vtt" onChange={(assetId) => set({ assetId })} />
        <Select label="Style" value={p.mode} options={[['karaoke', 'Karaoke highlight'], ['line', 'Current line'], ['line+next', 'Current + next line']] as const} onChange={(mode) => set({ mode })} />
        <Slider label="Sync offset" value={p.offset} min={-5} max={5} step={0.05} onChange={(offset) => set({ offset })} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}s`} />
        <Slider label="Fade" value={p.fade} min={0} max={1} onChange={(fade) => set({ fade })} format={(v) => `${v.toFixed(2)}s`} />
        {p.mode === 'karaoke' && <Color label="Highlight" value={p.highlight} onChange={(highlight) => set({ highlight })} />}
        <Color label="Dim colour" value={p.dimColor} onChange={(dimColor) => set({ dimColor })} />
        <TextStyleFields p={p} set={set} />
        <p className="hint">Enhanced LRC word timings give word-by-word karaoke. Otherwise the highlight sweeps evenly across each line.</p>
      </>;
    }
    case 'socials': {
      const p = layer.props;
      const items = p.items;
      const setItems = (next: typeof items) => set({ items: next });
      return <>
        <div className="socials">
          {items.map((it, i) => (
            <div className="social-row" key={i}>
              <select value={it.platform} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, platform: e.target.value as SocialPlatform } : x)))}>
                {Object.entries(SOCIAL_ICONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <input value={it.handle} placeholder="@handle" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, handle: e.target.value } : x)))} />
              <button title="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button onClick={() => setItems([...items, { platform: 'youtube', handle: '' }])}>+ Add social</button>
        </div>
        <Select label="Layout" value={p.layout} options={[['row', 'Row'], ['column', 'Stacked']] as const} onChange={(layout) => set({ layout })} />
        <Toggle label="Brand colours" value={p.brandColors} onChange={(brandColors) => set({ brandColors })} />
        {!p.brandColors && <Color label="Icon colour" value={p.iconColor} onChange={(iconColor) => set({ iconColor })} />}
        <TextStyleFields p={p} set={set} align={false} />
      </>;
    }
    case 'waveform': {
      const p = layer.props;
      return <>
        <Select label="Mode" value={p.mode} options={[['scope', 'Live oscilloscope'], ['progress', 'Whole song + progress']] as const} onChange={(mode) => set({ mode })} />
        <Select label="Style" value={p.style} options={[['line', 'Line'], ['mirror', 'Mirrored fill'], ['bars', 'Bars']] as const} onChange={(style) => set({ style })} />
        <Color label="Colour" value={p.color} onChange={(color) => set({ color })} />
        {p.mode === 'progress' && <Color label="Played colour" value={p.playedColor} onChange={(playedColor) => set({ playedColor })} />}
        <Slider label="Thickness" value={p.thickness} min={1} max={20} step={0.5} onChange={(thickness) => set({ thickness })} />
        <Slider label="Gain" value={p.gain} min={0.2} max={5} onChange={(gain) => set({ gain })} />
        <Slider label="Glow" value={p.glow} min={0} max={1} onChange={(glow) => set({ glow })} />
      </>;
    }
    case 'spectrum': {
      const p = layer.props;
      return <>
        <Select label="Style" value={p.style} options={[['bars', 'Bars'], ['mirror', 'Mirrored bars'], ['radial', 'Radial ring'], ['line', 'Smooth line']] as const} onChange={(style) => set({ style })} />
        <Slider label="Bars" value={p.bars} min={8} max={256} step={1} onChange={(bars) => set({ bars })} />
        <Color label="Colour" value={p.color} onChange={(color) => set({ color })} />
        <Color label="Colour 2" value={p.color2} onChange={(color2) => set({ color2 })} />
        <Slider label="Gap" value={p.gap} min={0} max={0.9} onChange={(gap) => set({ gap })} format={pct} />
        <Toggle label="Rounded" value={p.rounded} onChange={(rounded) => set({ rounded })} />
        <Slider label="Smoothing" value={p.smoothing} min={0} max={0.95} onChange={(smoothing) => set({ smoothing })} />
        <Slider label="Sensitivity" value={p.sensitivity} min={0.2} max={3} onChange={(sensitivity) => set({ sensitivity })} />
        <Slider label="Low cut (Hz)" value={p.minHz} min={20} max={500} step={5} onChange={(minHz) => set({ minHz })} />
        <Slider label="High cut (Hz)" value={p.maxHz} min={2000} max={20000} step={100} onChange={(maxHz) => set({ maxHz })} />
        <Slider label="Glow" value={p.glow} min={0} max={1} onChange={(glow) => set({ glow })} />
      </>;
    }
    case 'vu': {
      const p = layer.props;
      return <>
        <Select label="Style" value={p.style} options={[['led', 'LED segments'], ['bar', 'Solid bars'], ['needle', 'Analogue needles']] as const} onChange={(style) => set({ style })} />
        {p.style !== 'needle' && <Select label="Direction" value={p.orientation} options={['vertical', 'horizontal'] as const} onChange={(orientation) => set({ orientation })} />}
        {p.style === 'led' && <Slider label="Segments" value={p.segments} min={6} max={48} step={1} onChange={(segments) => set({ segments })} />}
        <Color label="Low" value={p.low} onChange={(low) => set({ low })} />
        <Color label="Mid" value={p.mid} onChange={(mid) => set({ mid })} />
        <Color label="High" value={p.high} onChange={(high) => set({ high })} />
        {p.style !== 'needle' && <Toggle label="Peak hold" value={p.peakHold} onChange={(peakHold) => set({ peakHold })} />}
        <Slider label="Sensitivity" value={p.sensitivity} min={0.2} max={4} onChange={(sensitivity) => set({ sensitivity })} />
      </>;
    }
  }
}

function VideoFields({ p, set }: { p: Extract<Layer, { type: 'video' }>['props']; set: (patch: Record<string, unknown>) => void }) {
  const duration = useStore((s) => s.assets[p.assetId ?? '']?.video?.duration ?? 0);
  return <>
    <AssetPicker kind="video" value={p.assetId} accept="video/*,.mp4,.m4v,.mov,.webm" onChange={(assetId) => set({ assetId, offset: 0 })} />
    <Select label="Fit" value={p.fit} options={['cover', 'contain', 'stretch'] as const} onChange={(fit) => set({ fit })} />
    <Slider label="Speed" value={p.speed} min={0.25} max={4} step={0.05} onChange={(speed) => set({ speed })} format={(v) => `${v.toFixed(2)}×`} />
    {duration > 0 && <Slider label="Start at" value={Math.min(p.offset, duration)} min={0} max={duration} step={0.05}
      onChange={(offset) => set({ offset })} format={(v) => `${v.toFixed(1)}s`} />}
    <Slider label="Beat flash" value={p.pulse} min={0} max={1.5} onChange={(pulse) => set({ pulse })} />
    <p className="hint">The clip plays silently and loops for the whole song. Export decodes every frame exactly, so renders with video take longer.</p>
  </>;
}

export function Inspector() {
  const layer = useSelectedLayer();
  const aspect = useStore((s) => s.aspect);
  const { updateLayer, setRect, copyRectToAll } = useStore.getState();
  if (!layer) return <aside className="inspector empty"><p>Select a layer to edit it, or drop images, songs and lyric files anywhere.</p></aside>;

  const r = layer.rects[aspect], A = ASPECTS[aspect];
  const setPx = (k: 'x' | 'y' | 'w' | 'h', v: number) => setRect(layer.id, aspect, { ...r, [k]: v / (k === 'x' || k === 'w' ? A.w : A.h) });

  return (
    <aside className="inspector">
      <input className="layer-name" value={layer.name} onChange={(e) => updateLayer(layer.id, { name: e.target.value })} />
      <section>
        <h4>{layer.type === 'milkdrop' ? 'Visualizer' : 'Content'}</h4>
        <TypeFields layer={layer} />
      </section>
      <section>
        <h4>Layer</h4>
        <Slider label="Opacity" value={layer.opacity} min={0} max={1} onChange={(opacity) => updateLayer(layer.id, { opacity })} format={pct} />
        <Select label="Blend" value={layer.blend} options={BLENDS} onChange={(blend) => updateLayer(layer.id, { blend })} />
      </section>
      <section>
        <h4>Position in {ASPECTS[aspect].label}</h4>
        <div className="grid2">
          <NumberInput label="X" value={r.x * A.w} onChange={(v) => setPx('x', v)} />
          <NumberInput label="Y" value={r.y * A.h} onChange={(v) => setPx('y', v)} />
          <NumberInput label="W" value={r.w * A.w} onChange={(v) => setPx('w', v)} />
          <NumberInput label="H" value={r.h * A.h} onChange={(v) => setPx('h', v)} />
        </div>
        <div className="buttons">
          <button onClick={() => setRect(layer.id, aspect, { x: 0, y: 0, w: 1, h: 1 })}>Fill frame</button>
          <button onClick={() => setRect(layer.id, aspect, { ...r, x: (1 - r.w) / 2, y: (1 - r.h) / 2 })}>Centre</button>
          <button title={`Copy this layout to ${ASPECT_IDS.filter((a) => a !== aspect).join(' and ')}`} onClick={() => copyRectToAll(layer.id, aspect)}>Copy to other formats</button>
        </div>
        <p className="hint">Each format keeps its own layout. Drag to move, pull the handles to resize. Shift keeps proportions and Alt turns off snapping.</p>
      </section>
    </aside>
  );
}

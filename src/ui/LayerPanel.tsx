import { useState } from 'react';
import { LAYER_LABELS, videoBackgroundIndex } from '../defaults';
import { useStore } from '../store';
import type { AssetKind, LayerType } from '../types';

const ADDABLE: LayerType[] = ['milkdrop', 'image', 'spectrum', 'waveform', 'vu', 'text', 'lyrics', 'socials', 'solid', 'video', 'particles'];
const ICON: Record<LayerType, string> = {
  solid: '■', video: '▶', particles: '✧', milkdrop: '✺', image: '▣', text: 'T', lyrics: '♪', socials: '@', waveform: '∿', spectrum: '▮', vu: '▥',
};

const ASSET_ICON: Record<AssetKind, string> = { image: '▣', audio: '♫', lyrics: '♪', video: '▶', font: 'Aa' };

export function LayerPanel() {
  const layers = useStore((s) => s.project.layers);
  const selectedId = useStore((s) => s.selectedId);
  const assets = useStore((s) => s.assets);
  const { addLayer, select, updateLayer, moveLayer, duplicateLayer, removeLayer, removeAsset } = useStore.getState();
  const [adding, setAdding] = useState(false);
  // Background colours go to the bottom, video backgrounds just above them, everything else on top.
  const atIndex = (t: LayerType) => (t === 'solid' ? 0 : t === 'video' ? videoBackgroundIndex(layers) : undefined);

  return (
    <aside className="layers">
      <div className="panel-head">
        <h4>Layers</h4>
        <button className="primary" onClick={() => setAdding((v) => !v)}>+ Add</button>
      </div>
      {adding && (
        <div className="add-menu">
          {ADDABLE.map((t) => (
            <button key={t} onClick={() => { addLayer(t, {}, atIndex(t)); setAdding(false); }}><span className="ico">{ICON[t]}</span>{LAYER_LABELS[t]}</button>
          ))}
        </div>
      )}
      <ul className="layer-list">
        {[...layers].reverse().map((l) => (
          <li key={l.id} className={l.id === selectedId ? 'selected' : ''} onClick={() => select(l.id)}>
            <button className="eye" title={l.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); updateLayer(l.id, { visible: !l.visible }); }}>
              {l.visible ? '●' : '○'}
            </button>
            <span className="ico">{ICON[l.type]}</span>
            <span className="name">{l.name}</span>
            <span className="actions" onClick={(e) => e.stopPropagation()}>
              <button title="Move up" onClick={() => moveLayer(l.id, 1)}>↑</button>
              <button title="Move down" onClick={() => moveLayer(l.id, -1)}>↓</button>
              <button title="Duplicate" onClick={() => duplicateLayer(l.id)}>⧉</button>
              <button title="Delete" onClick={() => removeLayer(l.id)}>✕</button>
            </span>
          </li>
        ))}
      </ul>

      <div className="panel-head"><h4>Files</h4></div>
      <ul className="asset-list">
        {Object.values(assets).map((a) => (
          <li key={a.meta.id}>
            {a.meta.kind === 'image' ? <img src={a.url} alt="" /> : <span className="ico">{ASSET_ICON[a.meta.kind]}</span>}
            <span className="name" title={a.meta.name}>{a.meta.name}</span>
            <button title="Delete file" onClick={() => removeAsset(a.meta.id)}>✕</button>
          </li>
        ))}
        {!Object.keys(assets).length && <li className="hint">Drop a song, images (PNG, SVG, JPG), video clips, fonts or lyrics (.lrc, .srt, .vtt) anywhere.</li>}
      </ul>
    </aside>
  );
}

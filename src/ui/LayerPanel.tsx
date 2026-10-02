import { useState } from 'react';
import { LAYER_LABELS, videoBackgroundIndex } from '../defaults';
import { useStore } from '../store';
import type { LayerType } from '../types';
import { AssetIcon, Icon, LayerIcon } from './icons';

const ADDABLE: LayerType[] = ['milkdrop', 'image', 'spectrum', 'waveform', 'vu', 'text', 'lyrics', 'socials', 'solid', 'video', 'particles'];

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
        <button aria-expanded={adding} onClick={() => setAdding((v) => !v)}>+ Add</button>
      </div>
      {adding && (
        <div className="add-menu">
          {ADDABLE.map((t) => (
            <button key={t} onClick={() => { addLayer(t, {}, atIndex(t)); setAdding(false); }}><span className="ico"><LayerIcon type={t} /></span>{LAYER_LABELS[t]}</button>
          ))}
        </div>
      )}
      <ul className="layer-list">
        {[...layers].reverse().map((l) => (
          <li key={l.id} className={l.id === selectedId ? 'selected' : ''}>
            <button className="eye" aria-pressed={l.visible} aria-label={`Show ${l.name}`} title={l.visible ? 'Hide' : 'Show'}
              onClick={() => updateLayer(l.id, { visible: !l.visible })}>
              <Icon name={l.visible ? 'eye' : 'eye-off'} />
            </button>
            <button className="layer-pick" aria-current={l.id === selectedId} onClick={() => select(l.id)}>
              <span className="ico"><LayerIcon type={l.type} /></span>
              <span className="name" title={l.name}>{l.name}</span>
            </button>
            <span className="actions">
              <button title="Move up" aria-label={`Move ${l.name} up`} onClick={() => moveLayer(l.id, 1)}><Icon name="up" size={14} /></button>
              <button title="Move down" aria-label={`Move ${l.name} down`} onClick={() => moveLayer(l.id, -1)}><Icon name="down" size={14} /></button>
              <button title="Duplicate" aria-label={`Duplicate ${l.name}`} onClick={() => duplicateLayer(l.id)}><Icon name="duplicate" size={14} /></button>
              <button title="Delete" aria-label={`Delete ${l.name}`} onClick={() => removeLayer(l.id)}><Icon name="close" size={14} /></button>
            </span>
          </li>
        ))}
      </ul>

      <div className="panel-head"><h4>Files</h4></div>
      <ul className="asset-list">
        {Object.values(assets).map((a) => (
          <li key={a.meta.id}>
            {a.meta.kind === 'image' ? <img src={a.url} alt="" /> : <span className="ico"><AssetIcon kind={a.meta.kind} /></span>}
            <span className="name" title={a.meta.name}>{a.meta.name}</span>
            <button title="Delete file" aria-label={`Delete ${a.meta.name}`} onClick={() => removeAsset(a.meta.id)}><Icon name="close" size={14} /></button>
          </li>
        ))}
        {!Object.keys(assets).length && <li className="hint">Drop a song, images (PNG, SVG, JPG), video clips, fonts or lyrics (.lrc, .srt, .vtt) anywhere.</li>}
      </ul>
    </aside>
  );
}

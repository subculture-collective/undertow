/**
 * Living style guide: /styleguide.html. It renders the real
 * components and reads token values from the loaded CSS, so it can't drift
 * from what the editor uses. See docs/design-system.md.
 */
import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BRAND } from './brand';
import { BrandLogo, BrandMark, PatreonButton, SocialLinks } from './ui/Brand';
import { Color, NumberInput, Select, Slider, Toggle } from './ui/controls';
import { Menu } from './ui/Menu';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/app.css';
import './styles/glitch.css';
import './styles/styleguide.css';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const SEMANTIC = [
  '--surface-app', '--surface-panel', '--surface-raised', '--surface-hover', '--surface-sunken', '--line', '--line-strong',
  '--text', '--text-dim', '--text-faint', '--accent', '--accent-2', '--accent-3', '--focus', '--warn', '--danger', '--success', '--patreon',
];
const TYPE = ['--text-2xs', '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-2xl'];
const SPACE = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7', '--space-8', '--space-9'];
const RADII = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill'];

function Swatches({ names }: { names: string[] }) {
  return (
    <div className="sg-swatches">
      {names.map((n) => (
        <div key={n} className="sg-swatch">
          <div style={{ background: `var(${n})` }} />
          <code>{n}</code>
          <span className="hint">{css(n)}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="sg-section"><h4>{title}</h4>{children}</section>;
}

function StyleGuide() {
  const [slider, setSlider] = useState(0.6);
  const [on, setOn] = useState(true);
  const [color, setColor] = useState('#ff9fe0');
  const [sel, setSel] = useState<'bars' | 'mirror'>('bars');
  const [tab, setTab] = useState(0);
  return (
    <div className="sg">
      <div className="sg-head">
        <BrandLogo size={32} />
        <span className="hint">Design system · {BRAND.tagline}</span>
      </div>

      <a className="btn" href="/">Open editor</a>

      <Section title="Brand">
        <div className="sg-row">
          <BrandMark size={96} />
          <BrandMark size={48} />
          <BrandMark size={24} />
          <span className="brand-name" style={{ fontSize: 'var(--text-2xl)' }}>{BRAND.name}</span>
          <span className="gradient-text" style={{ fontSize: 'var(--text-2xl)', fontWeight: 800 }}>Gradient text</span>
        </div>
        <div className="sg-row"><PatreonButton /><PatreonButton small label="Support" /><SocialLinks /></div>
        <p className="hint">Links outlined in dashed amber are still placeholders in src/brand.ts. Production builds leave them out.</p>
      </Section>

      <Section title="Colour tokens · Glitch"><Swatches names={SEMANTIC} /></Section>

      <Section title="Type">
        {TYPE.map((t) => (
          <div key={t} className="sg-type"><code>{t} · {css(t)}</code><span style={{ fontSize: `var(${t})` }}>The quick brown fox syncs to the beat</span></div>
        ))}
        <div className="sg-type"><code>--font-display</code><span className="brand-name" style={{ fontSize: 'var(--text-xl)' }}>Display caps</span></div>
        <div className="sg-type"><code>--font-mono</code><span style={{ fontFamily: 'var(--font-mono)' }}>0:42 / 3:15 · #ff2bd6</span></div>
        <div className="sg-type"><code>h4 / .eyebrow</code><span><h4>Section heading</h4><span className="eyebrow">Eyebrow</span></span></div>
      </Section>

      <Section title="Space and radius">
        <div className="sg-row">
          {SPACE.map((s) => <div key={s} className="sg-space" title={s}><div style={{ width: `var(${s})`, height: `var(${s})` }} /><code>{css(s)}</code></div>)}
        </div>
        <div className="sg-row">
          {RADII.map((r) => <div key={r} className="sg-radius" style={{ borderRadius: `var(${r})` }}><code>{r.replace('--radius-', '')}</code></div>)}
        </div>
      </Section>

      <Section title="Glow and elevation">
        <div className="sg-row">
          {['--glow-accent', '--glow-focus', '--shadow-panel', '--shadow-stage'].map((g) => (
            <div key={g} className="sg-elev" style={{ boxShadow: `var(${g})` }}><code>{g}</code></div>
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="sg-row">
          <button className="primary">Primary</button>
          <button>Secondary</button>
          <button className="ghost">Ghost</button>
          <button className="icon" aria-label="Undo">↶</button>
          <button className="ghost icon" aria-label="Info">ⓘ</button>
          <button disabled>Disabled</button>
          <button className="primary sm">Small primary</button>
          <button className="sm">Small</button>
        </div>
      </Section>

      <Section title="Fields">
        <div className="sg-panel">
          <Slider label="Slider" value={slider} min={0} max={1} onChange={setSlider} />
          <Toggle label="Toggle" value={on} onChange={setOn} />
          <Color label="Colour" value={color} onChange={setColor} />
          <Select label="Select" value={sel} options={[['bars', 'Bars'], ['mirror', 'Mirrored bars']] as const} onChange={setSel} />
          <NumberInput label="Number" value={42} onChange={() => {}} />
          <textarea rows={2} defaultValue="Textarea" />
          <p className="hint">Hint text uses --text-dim.</p>
          <p className="warn">Warning text</p>
        </div>
      </Section>

      <Section title="Tabs, menu, progress">
        <div className="sg-row">
          <div className="tabs">
            {['Landscape 16:9', 'Portrait 9:16', 'Square 1:1'].map((l, i) => (
              <button key={l} className={i === tab ? 'active' : ''} onClick={() => setTab(i)}>{l}</button>
            ))}
          </div>
          <Menu label="Menu"><button>First item</button><button>Second item</button></Menu>
        </div>
        <div className="progress" style={{ maxWidth: 420 }}>
          <div className="bar"><div style={{ width: '62%' }} /></div>
          <span className="hint">Progress bar</span>
        </div>
      </Section>

      <Section title="Panel and list">
        <div className="sg-panel" style={{ width: 256 }}>
          <ul className="layer-list">
            <li><button className="eye">●</button><span className="ico">✺</span><span className="name">Milkdrop visualizer</span></li>
            <li className="selected"><button className="eye">●</button><span className="ico">▮</span><span className="name">Spectrum (selected)</span></li>
            <li><button className="eye">○</button><span className="ico">T</span><span className="name">Hidden text</span></li>
          </ul>
        </div>
        <div className="support-nudge" style={{ maxWidth: 520 }}>
          <p>Support nudge, shown after a finished export.</p>
          <PatreonButton small />
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><StyleGuide /></StrictMode>);

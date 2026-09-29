import type { ReactNode } from 'react';

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="row">
      <span className="row-label">{label}</span>
      <span className="row-control">{children}</span>
    </label>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, format }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <Row label={label}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="value">{format ? format(value) : Number(value.toFixed(2))}</span>
    </Row>
  );
}

export function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row label={label}>
      <input type="color" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} />
      <input className="hex" value={value} onChange={(e) => onChange(e.target.value)} />
    </Row>
  );
}

export function Select<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly (T | readonly [T, string])[]; onChange: (v: T) => void;
}) {
  const opts = options.map((o) => (Array.isArray(o) ? o : [o, String(o)]) as readonly [T, string]);
  return (
    <Row label={label}>
      <select value={String(value)} onChange={(e) => {
        const hit = opts.find(([v]) => String(v) === e.target.value);
        if (hit) onChange(hit[0]);
      }}>
        {opts.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
    </Row>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </Row>
  );
}

export function NumberInput({ label, value, step = 1, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <Row label={label}>
      <input type="number" step={step} value={Math.round(value * 100) / 100} onChange={(e) => onChange(Number(e.target.value))} />
    </Row>
  );
}

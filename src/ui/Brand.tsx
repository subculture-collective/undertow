import { useId } from 'react';
import { BRAND, isSet, visibleLink } from '../brand';
import { SOCIAL_ICONS } from '../render/icons';

/** [x, height] of each bar, bottoms aligned at y = 25 in a 32-unit box. */
const BARS: [number, number][] = [[6.5, 8], [11, 14], [15.5, 19], [20, 12], [24.5, 6]];

/** The logomark: five spectrum bars in the theme's brand gradient. public/favicon.svg is the Neon version. */
export function BrandMark({ size = 26 }: { size?: number }) {
  // useId output contains characters that break url(#...) references, so keep only safe ones.
  const grad = `brand-grad-${useId().replace(/[^\w-]/g, '')}`;
  const bars = BARS.map(([x, h]) => <rect key={x} x={x} y={25 - h} width="3" height={h} rx="1.5" />);
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--brand-1)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--brand-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-3)' }} />
        </linearGradient>
      </defs>
      {/* rx as a style lets a theme square the corners; the attribute is the fallback. */}
      <rect x="1" y="1" width="30" height="30" rx="8" style={{ rx: 'var(--mark-radius, 8px)', fill: 'var(--surface-panel)' }}
        stroke={`url(#${grad})`} strokeWidth="2" />
      {/* Offset copies for a chromatic-aberration split; transparent unless a theme sets --mark-ab-a/b. */}
      <g transform="translate(-1.2 0)" style={{ fill: 'var(--mark-ab-a, transparent)' }}>{bars}</g>
      <g transform="translate(1.2 0)" style={{ fill: 'var(--mark-ab-b, transparent)' }}>{bars}</g>
      <g fill={`url(#${grad})`}>{bars}</g>
    </svg>
  );
}

export function BrandLogo({ size }: { size?: number }) {
  return (
    <span className="brand" title={BRAND.tagline}>
      <BrandMark size={size} />
      <span className="brand-name" data-text={BRAND.name}>{BRAND.name}</span>
    </span>
  );
}

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;
const unsetTitle = 'Placeholder link: set it in src/brand.ts. Hidden in production builds until then.';

export function SocialLinks() {
  const links = BRAND.socials.filter((l) => visibleLink(l.url));
  if (!links.length) return null;
  return (
    <nav className="social-links" aria-label={`${BRAND.name} on social media`}>
      {links.map((l) => (
        <a key={l.platform} href={l.url} {...external} className={isSet(l.url) ? '' : 'unset'}
          title={isSet(l.url) ? l.label : unsetTitle} aria-label={l.label}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={SOCIAL_ICONS[l.platform].path} /></svg>
        </a>
      ))}
    </nav>
  );
}

export function PatreonButton({ label = 'Support on Patreon', small = false }: { label?: string; small?: boolean }) {
  if (!visibleLink(BRAND.patreon)) return null;
  return (
    <a href={BRAND.patreon} {...external} className={`btn patreon ${small ? 'sm' : ''} ${isSet(BRAND.patreon) ? '' : 'unset'}`} aria-label={label}
      title={isSet(BRAND.patreon) ? `Support ${BRAND.name} on Patreon` : unsetTitle}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor"><path d={SOCIAL_ICONS.patreon.path} /></svg>
      <span className="label">{label}</span>
    </a>
  );
}

import { BRAND, isSet, visibleLink } from '../brand';
import { SOCIAL_ICONS } from '../render/icons';

/** [x, height] of each bar, bottoms aligned at y = 25 in a 32-unit box. */
const BARS: [number, number][] = [[6.5, 8], [11, 14], [15.5, 19], [20, 12], [24.5, 6]];

/** The logomark: five square spectrum bars with a sky and pink colour split. public/favicon.svg is the same drawing. */
export function BrandMark({ size = 26 }: { size?: number }) {
  const bars = BARS.map(([x, h]) => <rect key={x} x={x} y={25 - h} width="3" height={h} />);
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" style={{ fill: 'var(--surface-panel)', stroke: 'var(--text)' }} strokeWidth="2" />
      <g transform="translate(-1.2 0)" style={{ fill: 'var(--mark-ab-a)' }}>{bars}</g>
      <g transform="translate(1.2 0)" style={{ fill: 'var(--mark-ab-b)' }}>{bars}</g>
      <g style={{ fill: 'var(--text)' }}>{bars}</g>
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

/** Terms and privacy links. Each shows once its URL is set in src/brand.ts. */
export function LegalLinks() {
  const links = ([['Terms of service', BRAND.terms], ['Privacy policy', BRAND.privacy]] as const).filter(([, url]) => visibleLink(url));
  if (!links.length) return null;
  return (
    <nav className="legal-links" aria-label="Legal">
      {links.map(([label, url]) => (
        <a key={label} href={url} {...external} className={isSet(url) ? '' : 'unset'} title={isSet(url) ? undefined : unsetTitle}>{label}</a>
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

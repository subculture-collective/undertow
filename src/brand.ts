/**
 * Brand settings: the site name, tagline and links. This is the one file to
 * edit when renaming the site or filling in links. The Vite config reads it
 * too, for the page title, meta tags and share previews (see vite.config.ts).
 *
 * Any URL that still contains PLACEHOLDER is treated as unset. Unset links
 * show with a dashed amber outline during development and are left out of
 * production builds, so nothing links to a dead page.
 */
import type { SocialPlatform } from './types.ts';

export const PLACEHOLDER = 'PLACEHOLDER';

export interface BrandLink { platform: SocialPlatform; label: string; url: string }

export interface Brand {
  name: string;
  tagline: string;
  description: string;
  siteUrl: string;
  patreon: string;
  socials: BrandLink[];
}

export const BRAND: Brand = {
  name: 'Undertow',
  tagline: 'Music visualizer videos, made in your browser',
  description:
    'Build a layered music visualizer with Milkdrop, spectrum, lyrics, video and particles, then export MP4s for landscape, portrait and square. Your media stays on your device and rendering happens on your computer.',
  /** Public address of the deployed site, e.g. https://example.com. Needed for share-preview images. */
  siteUrl: `https://${PLACEHOLDER}.example`,
  patreon: `https://www.patreon.com/${PLACEHOLDER}`,
  socials: [
    { platform: 'instagram', label: 'Instagram', url: `https://www.instagram.com/${PLACEHOLDER}` },
    { platform: 'youtube', label: 'YouTube', url: `https://www.youtube.com/@${PLACEHOLDER}` },
    { platform: 'tiktok', label: 'TikTok', url: `https://www.tiktok.com/@${PLACEHOLDER}` },
    { platform: 'bluesky', label: 'Bluesky', url: `https://bsky.app/profile/${PLACEHOLDER}` },
  ],
};

export const isSet = (url: string) => !!url && !url.includes(PLACEHOLDER);

/** Links to render: configured ones always, unset ones only in development so they can be spotted. */
export const visibleLink = (url: string) => isSet(url) || import.meta.env.DEV;

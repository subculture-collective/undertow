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
  /** Who runs the site, and where people can write to them. Both appear on the terms and privacy pages. */
  operator: string;
  operatorUrl: string;
  contact: string;
  tagline: string;
  description: string;
  siteUrl: string;
  patreon: string;
  /** Terms of service and privacy policy pages (terms.html and privacy.html). Linked at sign-up, in billing and in About. */
  terms: string;
  privacy: string;
  socials: BrandLink[];
}

export const BRAND: Brand = {
  name: 'Undertow',
  operator: 'Subcult',
  operatorUrl: 'https://subcult.tv',
  contact: 'info@subcult.tv',
  tagline: 'Music visualizer videos, made in your browser',
  description:
    'Layer Milkdrop, a spectrum, VU meters, artwork and timed lyrics over your track. Lay it out in 16:9, 9:16 and 1:1, then render MP4 in your browser. Free, no watermark.',
  /** Public address of the deployed site, e.g. https://example.com. Needed for share-preview images. */
  siteUrl: 'https://undertow.subcult.tv',
  /** SUBCULT's Patreon custom domain. */
  patreon: 'https://support.subcult.tv',
  terms: '/terms.html',
  privacy: '/privacy.html',
  /** Only accounts that exist. Add Instagram, YouTube or TikTok here once they do. */
  socials: [{ platform: 'bluesky', label: 'Bluesky', url: 'https://bsky.app/profile/subcult.tv' }],
};

export const isSet = (url: string) => !!url && !url.includes(PLACEHOLDER);

/** Links to render: configured ones always, unset ones only in development so they can be spotted. */
export const visibleLink = (url: string) => isSet(url) || import.meta.env.DEV;

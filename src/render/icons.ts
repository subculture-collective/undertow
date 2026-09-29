import {
  siApplemusic, siBandcamp, siBluesky, siDeezer, siDiscord, siFacebook, siInstagram, siLinktree, siPatreon,
  siSoundcloud, siSpotify, siThreads, siTidal, siTiktok, siTwitch, siX, siYoutube,
} from 'simple-icons';
import type { SocialPlatform } from '../types';

interface IconDef { label: string; path: string; hex: string }

// Material "language" globe, 24x24, for generic websites.
const GLOBE = 'M12 2a10 10 0 100 20 10 10 0 000-20zm6.93 6h-2.95a15.65 15.65 0 00-1.38-3.56A8.03 8.03 0 0118.93 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a8.2 8.2 0 010-4h3.38a16.5 16.5 0 000 4H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.99 7.99 0 015.08 16zm2.95-8H5.08a7.99 7.99 0 014.33-3.56A15.65 15.65 0 008.03 8zM12 19.96A14.1 14.1 0 0110.09 16h3.82A14.1 14.1 0 0112 19.96zM14.34 14H9.66a14.7 14.7 0 010-4h4.68a14.7 14.7 0 010 4zm.25 5.56A15.65 15.65 0 0015.97 16h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14a16.5 16.5 0 000-4h3.38a8.2 8.2 0 010 4h-3.38z';

const si = (label: string, i: { path: string; hex: string }): IconDef => ({ label, path: i.path, hex: `#${i.hex}` });

export const SOCIAL_ICONS: Record<SocialPlatform, IconDef> = {
  instagram: si('Instagram', siInstagram),
  tiktok: si('TikTok', siTiktok),
  youtube: si('YouTube', siYoutube),
  spotify: si('Spotify', siSpotify),
  applemusic: si('Apple Music', siApplemusic),
  soundcloud: si('SoundCloud', siSoundcloud),
  bandcamp: si('Bandcamp', siBandcamp),
  x: si('X', siX),
  threads: si('Threads', siThreads),
  bluesky: si('Bluesky', siBluesky),
  facebook: si('Facebook', siFacebook),
  twitch: si('Twitch', siTwitch),
  discord: si('Discord', siDiscord),
  patreon: si('Patreon', siPatreon),
  linktree: si('Linktree', siLinktree),
  deezer: si('Deezer', siDeezer),
  tidal: si('TIDAL', siTidal),
  web: { label: 'Website', path: GLOBE, hex: '#ffffff' },
};

const cache = new Map<string, Path2D>();
export function iconPath(p: SocialPlatform): Path2D {
  let path = cache.get(p);
  if (!path) cache.set(p, (path = new Path2D(SOCIAL_ICONS[p].path)));
  return path;
}

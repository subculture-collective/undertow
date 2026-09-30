import { BRAND, visibleLink } from '../brand';
import { BrandMark, PatreonButton, SocialLinks } from './Brand';

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal about" role="dialog" aria-labelledby="about-title">
        <div className="about-hero">
          <BrandMark size={56} />
          <h2 id="about-title" className="brand-name" data-text={BRAND.name}>{BRAND.name}</h2>
          <p className="hint">{BRAND.tagline}</p>
        </div>
        <p>
          {BRAND.name} runs in your browser. Songs, images, clips and fonts stay on your device, and your computer
          encodes the video. If you sign in, your account stores project layouts and defaults so you can open them
          anywhere. Media is only uploaded if you choose to render in the cloud, and it's deleted when that render
          finishes.
        </p>
        {visibleLink(BRAND.patreon) && (
          <div className="support-nudge">
            <p>It's free to use. If it saves you time, you can support new features on Patreon.</p>
            <PatreonButton />
          </div>
        )}
        <SocialLinks />
        <dl>
          <dt>Visualizer</dt><dd><a href="https://github.com/jberg/butterchurn" target="_blank" rel="noopener noreferrer">Butterchurn</a>, with presets by the Milkdrop community</dd>
          <dt>Encoding</dt><dd><a href="https://mediabunny.dev" target="_blank" rel="noopener noreferrer">Mediabunny</a> and the browser's WebCodecs</dd>
          <dt>Icons</dt><dd><a href="https://simpleicons.org" target="_blank" rel="noopener noreferrer">Simple Icons</a></dd>
          <dt>Version</dt><dd>{__APP_VERSION__}</dd>
        </dl>
        <div className="buttons end"><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

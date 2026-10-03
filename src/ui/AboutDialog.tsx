import { BRAND, visibleLink } from '../brand';
import { BrandMark, LegalLinks, PatreonButton, SocialLinks } from './Brand';
import { Modal } from './Modal';

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal className="about" labelledBy="about-title" onClose={onClose}>
      <div className="about-hero">
        <BrandMark size={56} />
        <h2 id="about-title" className="brand-name" data-text={BRAND.name}>{BRAND.name}</h2>
        <p className="hint">{BRAND.tagline}</p>
      </div>
      <p>
        {BRAND.name} runs in your browser. Songs, images, clips and fonts stay on your device, and your computer
        does the encoding, so codecs and render speed depend on the browser and the hardware. If you sign in,
        your account stores project layouts and defaults so you can open them anywhere. Media is only uploaded
        if you choose to render in the cloud, and it's deleted when that render finishes.
      </p>
      {visibleLink(BRAND.patreon) && (
        <div className="support-nudge">
          <p>{BRAND.name} is free, with or without Patreon. Support there pays for the work on it.</p>
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
      <LegalLinks />
      <div className="buttons end"><button onClick={onClose}>Close</button></div>
    </Modal>
  );
}

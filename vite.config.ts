import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json' with { type: 'json' };
import { BRAND, isSet } from './src/brand.ts';

/**
 * Fills the page title, description, favicon and share-preview tags from
 * src/brand.ts, so renaming the site is a one-file change. Image and URL tags
 * need an absolute address and are only added once BRAND.siteUrl is set.
 */
function brandMeta(): Plugin {
  const title = `${BRAND.name} | Free Music Visualizer Video Editor`;
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const meta = (attrs: Record<string, string>): HtmlTagDescriptor => ({ tag: 'meta', attrs, injectTo: 'head' });
  return {
    name: 'vizstudio-brand-meta',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.path.endsWith('/index.html') && ctx.path !== '/') return html;
        const tags: HtmlTagDescriptor[] = [
          meta({ name: 'description', content: BRAND.description }),
          meta({ name: 'theme-color', content: '#0f0c1c' }),
          meta({ name: 'robots', content: 'index, follow, max-image-preview:large' }),
          { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }, injectTo: 'head' },
          meta({ property: 'og:type', content: 'website' }),
          meta({ property: 'og:site_name', content: BRAND.name }),
          meta({ property: 'og:title', content: title }),
          meta({ property: 'og:description', content: BRAND.description }),
          meta({ property: 'og:locale', content: 'en_US' }),
          meta({ name: 'twitter:card', content: 'summary_large_image' }),
          meta({ name: 'twitter:title', content: title }),
          meta({ name: 'twitter:description', content: BRAND.description }),
        ];
        if (isSet(BRAND.siteUrl)) {
          const site = BRAND.siteUrl.replace(/\/$/, '');
          tags.push(
            { tag: 'link', attrs: { rel: 'canonical', href: `${site}/` }, injectTo: 'head' },
            meta({ property: 'og:url', content: `${site}/` }),
            meta({ property: 'og:image', content: `${site}/og-glitch.png` }),
            meta({ property: 'og:image:secure_url', content: `${site}/og-glitch.png` }),
            meta({ property: 'og:image:type', content: 'image/png' }),
            meta({ property: 'og:image:width', content: '1200' }),
            meta({ property: 'og:image:height', content: '630' }),
            meta({ property: 'og:image:alt', content: 'Undertow music visualizer video editor, with pink, sky blue and lilac spectrum bars.' }),
            meta({ name: 'twitter:image', content: `${site}/og-glitch.png` }),
            meta({ name: 'twitter:image:alt', content: 'Undertow: free music visualizer videos, made in your browser.' }),
            { tag: 'script', attrs: { type: 'application/ld+json' }, injectTo: 'head', children: JSON.stringify({
              '@context': 'https://schema.org', '@type': 'WebApplication', name: BRAND.name,
              url: `${site}/`, description: BRAND.description, applicationCategory: 'MultimediaApplication',
              operatingSystem: 'Web browser', browserRequirements: 'Requires JavaScript and a browser with WebCodecs support for local MP4 export.',
              isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Free editing and local exports.' },
              image: `${site}/og-glitch.png`, featureList: ['Music visualizers', 'Waveforms and spectrum displays', 'Timed lyrics', 'Layered artwork and video', 'Landscape, portrait and square MP4 export'],
            }).replace(/</g, '\\u003c') },
          );
        }
        return { html: html.replace(/<title>.*<\/title>/, `<title>${escape(title)}</title>`), tags };
      },
    },
  };
}

/**
 * Dev-only endpoints for /selftest.html: receives results and saves them to
 * selftest-results/, and serves a local font for the font-upload check.
 */
function selftest(): Plugin {
  const fonts = [
    '/System/Library/Fonts/Supplemental/Apple Chancery.ttf',
    '/System/Library/Fonts/Supplemental/Courier New.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
  ];
  return {
    name: 'vizstudio-selftest',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__selftest/font', (_req, res) => {
        const f = fonts.find((p) => existsSync(p));
        if (!f) { res.statusCode = 404; res.end(); return; }
        res.setHeader('content-type', 'font/ttf');
        res.end(readFileSync(f));
      });
      server.middlewares.use('/__selftest', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const data = JSON.parse(body) as { at: string; checks: { name: string; ok: boolean }[] };
          const ua = req.headers['user-agent'] ?? '';
          const browser = /Edg\//.test(ua) ? 'edge' : /Chrome\//.test(ua) ? 'chrome' : /Firefox\//.test(ua) ? 'firefox' : /Safari\//.test(ua) ? 'safari' : 'other';
          mkdirSync('selftest-results', { recursive: true });
          const file = `selftest-results/${browser}-${data.at.replace(/[:.]/g, '-')}.json`;
          writeFileSync(file, JSON.stringify({ userAgent: ua, ...data }, null, 2));
          const passed = data.checks.filter((c) => c.ok).length;
          server.config.logger.info(`selftest (${browser}): ${passed}/${data.checks.length} passed -> ${file}`);
          res.end('ok');
        });
      });
    },
  };
}

/** Where the API runs in development (npm run api:dev). The proxy keeps editor and API on one origin, so session cookies just work. */
const API = process.env.UNDERTOW_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), brandMeta(), selftest()],
  server: {
    proxy: {
      '/v1': { target: API, changeOrigin: false },
      '/docs': { target: API, changeOrigin: false },
      '/internal': { target: API, changeOrigin: false },
    },
  },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Include the worker page and the design system catalogue in deployments.
  build: { rollupOptions: { input: { main: 'index.html', render: 'render.html', styleguide: 'styleguide.html' } } },
  optimizeDeps: {
    // UMD/CommonJS bundles that need pre-bundling for ESM import.
    include: [
      'butterchurn',
      'butterchurn-presets',
      'butterchurn-presets/lib/butterchurnPresetsExtra.min.js',
      'butterchurn-presets/lib/butterchurnPresetsExtra2.min.js',
      'butterchurn-presets/lib/butterchurnPresetsMD1.min.js',
    ],
  },
});

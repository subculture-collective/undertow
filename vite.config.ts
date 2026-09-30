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
  const title = `${BRAND.name}: ${BRAND.tagline}`;
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
          meta({ name: 'theme-color', content: '#07060d' }),
          { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }, injectTo: 'head' },
          meta({ property: 'og:type', content: 'website' }),
          meta({ property: 'og:site_name', content: BRAND.name }),
          meta({ property: 'og:title', content: title }),
          meta({ property: 'og:description', content: BRAND.description }),
          meta({ name: 'twitter:card', content: 'summary_large_image' }),
        ];
        if (isSet(BRAND.siteUrl)) {
          const site = BRAND.siteUrl.replace(/\/$/, '');
          tags.push(
            { tag: 'link', attrs: { rel: 'canonical', href: `${site}/` }, injectTo: 'head' },
            meta({ property: 'og:url', content: `${site}/` }),
            meta({ property: 'og:image', content: `${site}/og.png` }),
            meta({ property: 'og:image:width', content: '1200' }),
            meta({ property: 'og:image:height', content: '630' }),
            meta({ name: 'twitter:image', content: `${site}/og.png` }),
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
  // The render page is part of production builds: the cloud render worker loads it.
  build: { rollupOptions: { input: { main: 'index.html', render: 'render.html' } } },
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

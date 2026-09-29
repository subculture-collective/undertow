import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({
  plugins: [react(), selftest()],
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

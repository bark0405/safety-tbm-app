import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const assets = resolve(dist, 'assets');

await mkdir(assets, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/main.jsx')],
  bundle: true,
  format: 'iife',
  globalName: 'PermitToTbmCopilot',
  outfile: resolve(assets, 'app-iife.js'),
  jsx: 'automatic',
  target: ['es2018'],
  define: {
    'import.meta.env.BASE_URL': '"/"',
  },
  loader: {
    '.svg': 'dataurl',
    '.png': 'dataurl',
    '.jpg': 'dataurl',
    '.jpeg': 'dataurl',
    '.webp': 'dataurl',
  },
});

await writeFile(
  resolve(dist, 'index.html'),
  `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="작업허가서 기반 오늘의 작업위험 브리핑 AI" />
    <title>Permit-to-TBM Copilot</title>
    <link rel="stylesheet" href="/assets/app-iife.css" />
  </head>
  <body>
    <div id="root"></div>
    <script src="/assets/app-iife.js"></script>
  </body>
</html>
`,
  'utf8'
);

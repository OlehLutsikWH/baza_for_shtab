// Збирає демо в один HTML-файл: demo/dist/oblik-avto-demo.html
// React 18.3.1 підключається з cdnjs (у React 19 немає UMD-збірки); решта — вбудована.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shim = f => join(here, 'shims', f);
const ALIAS = {
  'next/link': shim('next-link.tsx'),
  'next/navigation': shim('next-navigation.ts'),
  'react': shim('react.cjs'),
  'react-dom/client': shim('react-dom-client.cjs'),
  'react/jsx-runtime': shim('react-jsx-runtime.js'),
  '@supabase/supabase-js': shim('supabase-stub.ts'),
};

const demoPlugin = {
  name: 'demo',
  setup(b) {
    b.onResolve({ filter: /^(next\/link|next\/navigation|react|react-dom\/client|react\/jsx-runtime|@supabase\/supabase-js)$/ }, a => ({ path: ALIAS[a.path] }));
    b.onResolve({ filter: /^(react-dom|next\/.*)$/ }, a => ({ errors: [{ text: `Демо не підтримує імпорт «${a.path}»` }] }));
    // Сторінка-артефакт не може сама почати завантаження: saveFile() підміняється демо-версією.
    b.onLoad({ filter: /src[\\/]lib[\\/]base[\\/]files\.ts$/ }, a => {
      const src = readFileSync(a.path, 'utf8');
      const marker = 'export function saveFile(';
      if (!src.includes(marker)) throw new Error('files.ts: не знайдено saveFile() — оновіть demo/build.mjs');
      return {
        contents: src.replace(marker, 'function moduleSaveFile(') + `\nexport { demoSaveFile as saveFile } from ${JSON.stringify(join(here, 'download.ts'))};\n`,
        loader: 'ts', resolveDir: dirname(a.path),
      };
    });
    // Шрифти для PDF публікуються поруч зі сторінкою (fonts/…), а не з кореня сайту.
    b.onLoad({ filter: /src[\\/]lib[\\/]base[\\/]config\.ts$/ }, a => {
      const src = readFileSync(a.path, 'utf8');
      const marker = "export const REPORT_FONT_BASE = '/base/fonts/';";
      if (!src.includes(marker)) throw new Error('config.ts: не знайдено REPORT_FONT_BASE — оновіть demo/build.mjs');
      return { contents: src.replace(marker, "export const REPORT_FONT_BASE = 'fonts/';"), loader: 'ts', resolveDir: dirname(a.path) };
    });
  },
};

const res = await build({
  entryPoints: [join(here, 'main.tsx')], bundle: true, write: false, outdir: join(here, 'dist'),
  format: 'iife', minify: true, target: 'es2020', charset: 'utf8', legalComments: 'none', logLevel: 'warning',
  jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', inject: [shim('react-inject.js')],
  define: {
    'process.env.NEXT_PUBLIC_SUPABASE_URL': 'undefined',
    'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': 'undefined',
    'process.env.NODE_ENV': '"production"',
    // У IIFE немає import.meta: pdfkit і yoga лише будують з нього адреси (файли не завантажують)
    'import.meta.url': '"https://demo.invalid/"',
  },
  plugins: [demoPlugin],
});
const out = ext => res.outputFiles.find(f => f.path.endsWith(ext))?.text ?? '';
const js = out('.js'), css = out('.css');
if (!js) throw new Error('Порожня збірка');

const html = `<title>Облік авто СТО БАЗА</title>
<style>
${readFileSync(join(here, 'demo.css'), 'utf8')}
${css}</style>
<div id="root"><p class="demo-loading">Завантаження демо…</p></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>if(!window.React||!window.ReactDOM){document.getElementById('root').innerHTML='<p class="demo-loading">Не вдалося завантажити інтерфейс. Оновіть сторінку.</p>'}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
mkdirSync(join(here, 'dist'), { recursive: true });
const file = join(here, 'dist', 'oblik-avto-demo.html');
writeFileSync(file, html);
console.log(`${file}: ${(html.length / 1024).toFixed(1)} КБ (JS ${(js.length / 1024).toFixed(1)} КБ, CSS ${(css.length / 1024).toFixed(1)} КБ)`);

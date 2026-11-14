// 앱에 넣을 웹 파일을 dist/에 모은다. 웹(깃허브 페이지)은 저장소 루트 파일을 그대로 쓴다.
import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';

const out = 'dist';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ['index.html', 'style.css', 'manifest.json', 'icons', 'js']) {
  await cp(item, `${out}/${item}`, { recursive: true });
}
await build({ entryPoints: ['scripts/native-entry.js'], bundle: true, format: 'iife', target: 'es2020', outfile: `${out}/js/native.js`, logLevel: 'warning' });

const appTag = '<script type="module" src="js/app.js"></script>';
const html = await readFile(`${out}/index.html`, 'utf8');
if (!html.includes(appTag)) throw new Error('index.html에서 앱 스크립트 자리를 찾지 못했어');
await writeFile(`${out}/index.html`, html.replace(appTag, `<script src="js/native.js"></script>\n  ${appTag}`));
console.log('dist/ 준비 완료');

// Icône de Relis : une coche d'écriture verte sur une tuile sombre (PNG, ICO multi-tailles, icône de la zone de notification).
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { mkdir, writeFile } from 'node:fs/promises';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 64 64">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#0b8a5f"/></linearGradient>
  <linearGradient id="hi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<rect x="2" y="2" width="60" height="60" rx="15" fill="url(#bg)"/>
<rect x="2" y="2" width="60" height="60" rx="15" fill="url(#hi)"/>
<path d="M14 22h22M14 31h14" stroke="#fff" stroke-opacity=".55" stroke-width="4.5" stroke-linecap="round"/>
<path d="M27 42.5 34.5 50 51 30" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

await mkdir('build', { recursive: true });
const buf = Buffer.from(svg);
await sharp(buf).resize(512, 512).png().toFile('build/icon.png');
await sharp(buf).resize(256, 256).png().toFile('app/icon.png');
await sharp(buf).resize(32, 32).png().toFile('app/tray.png');
await writeFile('build/icon.ico', await pngToIco(await Promise.all([16, 24, 32, 48, 64, 128, 256].map((s) => sharp(buf).resize(s, s).png().toBuffer()))));
console.log('icônes ok');

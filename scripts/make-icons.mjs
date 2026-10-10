// Genera los iconos PNG de la app a partir de public/icon.svg:  npm run icons
import sharp from 'sharp';
import fs from 'node:fs';

const svg = fs.readFileSync('public/icon.svg');
const targets = [
  ['public/icon-192.png', 192],
  ['public/icon-512.png', 512],
  ['public/icon-maskable-512.png', 512], // el dibujo ya queda dentro de la zona segura (80 %)
  ['public/apple-touch-icon.png', 180],
];
for (const [file, size] of targets) {
  await sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file);
  console.log('creado', file, `${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
}

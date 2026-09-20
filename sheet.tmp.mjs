import sharp from 'sharp';
import { readdirSync } from 'node:fs';
const dir = process.argv[2], out = process.argv[3], from = +(process.argv[4]||0), to = +(process.argv[5]||24);
const files = readdirSync(dir).filter(f=>/\.(png|jpe?g|webp)$/i.test(f))
  .sort((a,b)=>+a.replace(/\D+/g,'') - +b.replace(/\D+/g,'')).slice(from,to);
const CELL = 230, COLS = 6, PAD = 6, LB = 18;
const rows = Math.ceil(files.length/COLS);
const canvas = sharp({ create: { width: COLS*(CELL+PAD)+PAD, height: rows*(CELL+PAD+LB)+PAD, channels: 3, background:'#111' }});
const parts = [];
for (const [i,f] of files.entries()) {
  const x = PAD + (i%COLS)*(CELL+PAD), y = PAD + Math.floor(i/COLS)*(CELL+PAD+LB);
  const buf = await sharp(`${dir}/${f}`).resize(CELL, CELL, { fit:'contain', background:'#111' }).toBuffer();
  parts.push({ input: buf, left: x, top: y });
  const svg = `<svg width="${CELL}" height="${LB}"><text x="2" y="13" font-family="monospace" font-size="12" fill="#bbb">${f}</text></svg>`;
  parts.push({ input: Buffer.from(svg), left: x, top: y+CELL });
}
await canvas.composite(parts).png().toFile(out);
console.log('wrote', out, files.length, 'cells');

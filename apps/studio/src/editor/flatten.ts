import type { TextLayer } from '../api.js';
import { fontById } from './fonts.js';

/** Base width the layer `size` is authored against. */
export const SIZE_BASE = 1024;

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const hard of text.split('\n')) {
    const words = hard.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const w of words) {
      const probe = line ? `${line} ${w}` : w;
      if (ctx.measureText(probe).width <= maxWidth || !line) line = probe;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export function drawLayers(ctx: CanvasRenderingContext2D, layers: TextLayer[], imgW: number, imgH: number): void {
  const scale = imgW / SIZE_BASE;
  for (const l of layers) {
    const font = fontById(l.fontId);
    const px = l.size * scale;
    const text = l.uppercase ? l.text.toUpperCase() : l.text;
    ctx.save();
    ctx.font = `${l.weight} ${px}px ${font.family}`;
    if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${(l.letterSpacing ?? 0) * scale}px`;
    ctx.globalAlpha = l.opacity;
    ctx.textBaseline = 'top';

    const boxX = (l.x / 100) * imgW;
    const boxW = (l.width / 100) * imgW;
    const lines = wrapText(ctx, text, boxW);
    const lineXY = lines.map((line, i) => {
      const lw = ctx.measureText(line).width;
      const x = l.align === 'center' ? boxX + (boxW - lw) / 2 : l.align === 'right' ? boxX + boxW - lw : boxX;
      return { line, x, y: (l.y / 100) * imgH + i * px * l.lineHeight, lw };
    });

    if (l.background) {
      ctx.fillStyle = l.background.color;
      const padX = l.background.paddingX * scale;
      const padY = l.background.paddingY * scale;
      const r = l.background.radius * scale;
      for (const { x, y, lw } of lineXY) {
        ctx.beginPath();
        (ctx as any).roundRect(x - padX, y - padY, lw + padX * 2, px * l.lineHeight + padY * 2, r);
        ctx.fill();
      }
    }
    if (l.shadow) {
      ctx.shadowColor = l.shadow.color;
      ctx.shadowBlur = l.shadow.blur * scale;
      ctx.shadowOffsetX = l.shadow.x * scale;
      ctx.shadowOffsetY = l.shadow.y * scale;
    }
    ctx.fillStyle = l.color;
    for (const { line, x, y } of lineXY) {
      ctx.fillText(line, x, y);
      if (l.stroke && l.stroke.width > 0) {
        ctx.save();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = l.stroke.color;
        ctx.lineWidth = l.stroke.width * scale;
        ctx.strokeText(line, x, y);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

/** WYSIWYG flatten: image at natural size + layers, exact same math as the DOM preview. */
export async function flattenToBlob(imageUrl: string, layers: TextLayer[]): Promise<Blob> {
  await Promise.all(layers.map((l) => document.fonts.load(`${l.weight} 32px ${fontById(l.fontId).family}`)));
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('image load failed'));
    img.src = imageUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  drawLayers(ctx, layers, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
}

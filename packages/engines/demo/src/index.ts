import sharp from 'sharp';
import type { EngineAdapter, EngineCapabilities, EngineResult, GenerateRequest, EditRequest } from '@scenri/core';

/**
 * Demo engine: always available, zero cost. Renders a placeholder using the
 * brand palette + prompt text so every flow works without keys or agents.
 */
export function createDemoEngine(saveImage: (buf: Buffer) => string): EngineAdapter {
  const paletteOf = (req: GenerateRequest | EditRequest): string[] => {
    const p = (req.brand?.brand as any)?.palette;
    const hexes = [p?.primary?.hex, p?.secondary?.hex, ...(p?.accent ?? []).map((a: any) => a?.hex)].filter(
      (h: unknown): h is string => typeof h === 'string' && /^#[0-9a-fA-F]{6}$/.test(h),
    );
    return hexes.length ? hexes : ['#4B5563', '#9CA3AF'];
  };

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 90);

  async function render(colors: string[], label: string, w: number, h: number, seed: number): Promise<Buffer> {
    const c0 = colors[seed % colors.length];
    const c1 = colors[(seed + 1) % colors.length] ?? '#111111';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c0}"/><stop offset="100%" stop-color="${c1}"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${w * (0.25 + (0.5 * ((seed * 37) % 100)) / 100)}" cy="${h * 0.38}" r="${Math.min(w, h) * 0.18}" fill="#ffffff" opacity="0.25"/>
      <text x="24" y="${h - 48}" font-family="Helvetica, Arial" font-size="${Math.max(14, Math.round(w / 42))}" fill="#ffffff" opacity="0.92">${esc(label)}</text>
      <text x="24" y="${h - 22}" font-family="Helvetica, Arial" font-size="12" fill="#ffffff" opacity="0.6">Scenri demo engine</text>
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  return {
    capabilities(): EngineCapabilities {
      return {
        id: 'demo',
        displayName: 'Demo',
        localOnly: false,
        supportsEdit: true,
        supportsMask: false,
        // It draws a placeholder for everything, expansions included, so it
        // stands in for a capable engine rather than blocking the path in
        // development and in the end-to-end suite. `placeholder` below is what
        // says none of this is a real picture.
        supportsOutpaint: true,
        maxReferenceImages: 0,
        placeholder: true,
      };
    },
    async isAvailable() {
      return { ok: true };
    },
    async costEstimate() {
      return 0;
    },
    async generate(req: GenerateRequest): Promise<EngineResult> {
      const colors = paletteOf(req);
      const images: string[] = [];
      for (let i = 0; i < Math.max(1, req.count); i++) {
        images.push(saveImage(await render(colors, req.prompt, req.width, req.height, i + req.prompt.length)));
      }
      return { images, costUsd: 0 };
    },
    async edit(req: EditRequest): Promise<EngineResult> {
      const colors = paletteOf(req);
      // The requested canvas, when the server states one: a hardcoded square
      // made every demo edit of a non-square shot fail the aspect check.
      const buf = await render(
        colors,
        `edit: ${req.instruction}`,
        req.width ?? 1024,
        req.height ?? 1024,
        req.instruction.length,
      );
      return { images: [saveImage(buf)], costUsd: 0 };
    },
  };
}

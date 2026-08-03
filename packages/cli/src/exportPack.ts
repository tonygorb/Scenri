import sharp from 'sharp';
import JSZip from 'jszip';

export interface ExportPreset {
  id: string;
  label: string;
  width: number | null; // null = original
  height: number | null;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'original', label: 'Original', width: null, height: null },
  { id: 'ig-post', label: 'Instagram post 1080×1080', width: 1080, height: 1080 },
  { id: 'ig-story', label: 'Story 1080×1920', width: 1080, height: 1920 },
  { id: 'banner', label: 'Banner 1200×628', width: 1200, height: 628 },
];

export async function buildExportZip(image: Buffer, baseName: string, presetIds: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const chosen = EXPORT_PRESETS.filter((p) => presetIds.includes(p.id));
  if (chosen.length === 0) throw new Error('No valid export presets selected');
  for (const p of chosen) {
    const buf =
      p.width && p.height
        ? await sharp(image).resize(p.width, p.height, { fit: 'cover', position: 'attention' }).png().toBuffer()
        : image;
    zip.file(`${baseName}-${p.id}.png`, buf);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

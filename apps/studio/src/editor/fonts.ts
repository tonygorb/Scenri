import '@fontsource-variable/inter-tight';
import '@fontsource-variable/inter';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/600.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/700.css';

export interface EditorFont {
  id: string;
  label: string;
  family: string;
  weights: number[];
}

/** Curated open fonts, all bundled locally (no CDN — CSP/offline safe). */
export const EDITOR_FONTS: EditorFont[] = [
  {
    id: 'inter-tight',
    label: 'Inter Tight',
    family: "'Inter Tight Variable', 'Inter Tight', sans-serif",
    weights: [400, 500, 700],
  },
  { id: 'inter', label: 'Inter', family: "'Inter Variable', Inter, sans-serif", weights: [400, 600, 800] },
  { id: 'playfair', label: 'Playfair Display', family: "'Playfair Display', serif", weights: [400, 700] },
  { id: 'bebas', label: 'Bebas Neue', family: "'Bebas Neue', sans-serif", weights: [400] },
  { id: 'lora', label: 'Lora', family: 'Lora, serif', weights: [400, 600] },
  { id: 'dm-sans', label: 'DM Sans', family: "'DM Sans', sans-serif", weights: [400, 700] },
];

export const fontById = (id: string): EditorFont => EDITOR_FONTS.find((f) => f.id === id) ?? EDITOR_FONTS[0];

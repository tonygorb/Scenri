import { useThemeMode, type ThemeChoice } from '../../theme.js';
import { Group } from './Group.js';

export function Appearance() {
  const { choice, setChoice } = useThemeMode();
  const opts: { id: ThemeChoice; label: string; swatch: string }[] = [
    { id: 'light', label: 'Light', swatch: 'linear-gradient(140deg,#ffffff 55%,#f1f1f1)' },
    { id: 'dark', label: 'Dark', swatch: 'linear-gradient(140deg,#0d0d0d 55%,#1c1c1c)' },
    { id: 'system', label: 'System', swatch: 'linear-gradient(110deg,#ffffff 50%,#0d0d0d 50%)' },
  ];
  return (
    <Group sub="Follows your system unless you pick a side.">
      <div className="sc-themes">
        {opts.map((o) => (
          <button
            type="button"
            key={o.id}
            className="sc-tp"
            data-on={choice === o.id ? '' : undefined}
            onClick={() => setChoice(o.id)}
          >
            <span className="swl" style={{ background: o.swatch }} />
            <span className="lbl">
              <span className="dot" />
              {o.label}
            </span>
          </button>
        ))}
      </div>
    </Group>
  );
}

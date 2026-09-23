import { Choice, Choices } from '../../composer/shotSettings/Choices.js';
import { useThemeMode, type ThemeChoice } from '../../theme.js';
import { Group } from './Group.js';

const OPTIONS: { id: ThemeChoice; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

/** One choice, so one row: the segmented control the composer's settings already use. */
export function Appearance() {
  const { choice, setChoice } = useThemeMode();
  return (
    <Group>
      <div className="sc-set-row">
        <span className="txt">
          <b>Theme</b>
          <small>Follows your system unless you pick a side.</small>
        </span>
        <Choices
          label="Theme"
          className="sc-seg"
          value={choice}
          ids={OPTIONS.map((o) => o.id)}
          onChange={(id) => setChoice(id as ThemeChoice)}
        >
          {OPTIONS.map((o) => (
            <Choice
              key={o.id}
              id={o.id}
              className="sc-seg-o"
              on={choice === o.id}
              label={o.label}
              onPick={() => setChoice(o.id)}
            >
              {o.label}
            </Choice>
          ))}
        </Choices>
      </div>
    </Group>
  );
}

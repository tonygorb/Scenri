import { Dialog } from '@radix-ui/themes';

/**
 * Every key the app actually listens for, and nothing else. The list is a
 * contract: if a row is here, it works. Bindings live in Project.tsx and
 * BriefInput.tsx; this only describes them.
 */
const KEYS: { label: string; keys: string[] }[] = [
  { label: 'Generate', keys: ['cmd', 'enter'] },
  { label: 'Insert menu', keys: ['/'] },
  { label: 'Ingredient menu', keys: ['@'] },
  { label: 'Look menu', keys: ['#'] },
  { label: 'Walk siblings', keys: ['←', '→'] },
  { label: 'Walk lineage', keys: ['↑', '↓'] },
  { label: 'Step variants', keys: ['[', ']'] },
  { label: 'Keep or unkeep', keys: ['k'] },
  { label: 'Open the shot', keys: ['enter'] },
  { label: 'Close the shot', keys: ['esc'] },
  { label: 'Assets panel', keys: ['.'] },
  { label: 'This list', keys: ['?'] },
];

export function Shortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="360px" aria-describedby={undefined}>
        <Dialog.Title>Shortcuts</Dialog.Title>
        <div className="sc-keys">
          {KEYS.map((k) => (
            <div className="sc-krow" key={k.label}>
              <span>{k.label}</span>
              <span className="sc-ksp" />
              {k.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </div>
          ))}
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

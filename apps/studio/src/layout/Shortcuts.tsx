import { Dialog } from '@radix-ui/themes';

/**
 * Every key the app actually listens for, and nothing else. The list is a
 * contract: if a row is here, it works. Bindings live in Create.tsx and
 * BriefInput.tsx; this only describes them.
 */
const KEYS: { label: string; keys: string[] }[] = [
  { label: 'Generate', keys: ['cmd', 'enter'] },
  { label: 'Jump to the brief', keys: ['/'] },
  { label: 'Product menu', keys: ['/'] },
  { label: 'Presenter menu', keys: ['@'] },
  { label: 'Scene menu', keys: ['#'] },
  // siblings are whole runs off one parent, so they are versions; the images
  // inside a single run are its variants. Two words, two rows, one meaning each.
  { label: 'Walk versions', keys: ['←', '→'] },
  { label: 'Walk lineage', keys: ['↑', '↓'] },
  { label: 'Step variants', keys: ['[', ']'] },
  { label: 'Refine this shot', keys: ['b'] },
  { label: 'Keep or unkeep', keys: ['k'] },
  { label: 'Open the shot', keys: ['enter'] },
  { label: 'Close, or stop refining', keys: ['esc'] },
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

import { DropdownMenu } from '@radix-ui/themes';
import { CaretDown } from '@phosphor-icons/react';
import { categoryLabel, PRODUCT_CATEGORIES } from '../productCategories.js';

/**
 * How a product is filed. One choice from the closed list, inside Details:
 * the record itself wears the same static chip a scene does.
 */
export function CategoryPicker({ value, onChange }: { value: string | null; onChange: (key: string) => void }) {
  const current = categoryLabel(value) ?? 'Other';
  const selected = value && PRODUCT_CATEGORIES.some((c) => c.key === value) ? value : 'other';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <button type="button" className="sc-pdetails-field sc-catpick" aria-label={`Category: ${current}`}>
          {current}
          <CaretDown size={11} weight="bold" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="center" sideOffset={8}>
        <DropdownMenu.RadioGroup value={selected}>
          {PRODUCT_CATEGORIES.map((c) => (
            <DropdownMenu.RadioItem key={c.key} value={c.key} onSelect={() => onChange(c.key)}>
              {c.label}
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

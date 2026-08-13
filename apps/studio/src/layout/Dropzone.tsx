import { type ReactNode, useCallback, useRef, useState } from 'react';
import { Spinner } from '@radix-ui/themes';

/**
 * Drag-and-drop file input, extracted from the products panel so the Brand
 * page's marks section does not become a second copy of the same fiddly bits.
 *
 * The depth counter is the reason this is worth sharing at all: dragenter and
 * dragleave fire for every child element the pointer crosses, so a naive
 * boolean flickers off the moment the cursor moves over the text inside the
 * zone. Counting entries and exits is what makes the highlight hold.
 */
export interface FileDropOptions {
  onFiles: (files: File[]) => void;
  /** Called when something was dropped but nothing in it was an image. */
  onReject?: () => void;
  disabled?: boolean;
}

export function useFileDrop({ onFiles, onReject, disabled }: FileDropOptions) {
  const depth = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  const reset = useCallback(() => {
    depth.current = 0;
    setDragOver(false);
  }, []);

  const dropProps = {
    'data-drag-over': dragOver || undefined,
    onDragEnter: (e: React.DragEvent) => {
      // Text selections and links also fire drag events; only files count.
      if (disabled || !Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      depth.current++;
      setDragOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (!disabled) e.preventDefault();
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      reset();
      const images = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
      if (images.length) onFiles(images);
      else onReject?.();
    },
  };

  return { dragOver, dropProps };
}

/**
 * A standalone drop target that is also a button, because a dropzone that can
 * only be dropped into is unusable with a keyboard and unusable on a phone.
 */
export function Dropzone({
  label,
  hint,
  busy,
  disabled,
  multiple = true,
  accept = 'image/*',
  onFiles,
  onReject,
  children,
}: FileDropOptions & {
  label: string;
  hint?: string;
  busy?: boolean;
  multiple?: boolean;
  accept?: string;
  children?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { dropProps } = useFileDrop({ onFiles, onReject, disabled: disabled || busy });

  return (
    <button
      type="button"
      className="sc-dropzone"
      disabled={disabled || busy}
      onClick={() => fileRef.current?.click()}
      {...dropProps}
    >
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // Reset the input, or picking the same file twice in a row is a no-op.
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      {busy ? <Spinner /> : children}
      <span className="sc-dropzone-label">{label}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}

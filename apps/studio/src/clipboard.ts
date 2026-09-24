/**
 * Copy text, wherever the studio is open. `navigator.clipboard` exists only
 * in a secure context: this computer's own 127.0.0.1 is one, a phone on the
 * Wi-Fi opening http://192.168.x.x is not, and there it is simply undefined.
 * The old select-and-copy still works there, from inside a click.
 *
 * `host` is where the stand-in field goes: inside an open dialog, never on
 * the body, because a dialog's focus trap pulls focus back out of anything
 * outside it before the copy can read the selection.
 */
export async function copyText(text: string, host?: HTMLElement | null): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // denied: try the old way below
    }
  }
  const back = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  (host ?? document.body).appendChild(field);
  try {
    field.focus();
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    back?.focus();
  }
}

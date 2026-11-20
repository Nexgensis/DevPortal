// Clipboard helper for vault secrets: copy, then wipe after a delay.
//
// Limits worth knowing (shown to the user in the UI):
//  - Browsers only allow clipboard writes while the page has focus. If the tab
//    is in the background when the timer fires, we wait for it to regain
//    focus and clear then.
//  - OS clipboard-history tools (Windows Win+V, macOS managers) may keep their
//    own copy; no web page can reach those.
//
// We only clear if the clipboard still holds *our* value, so a password
// doesn't wipe something the user copied since. Reading the clipboard can
// need a permission; if we can't read, we clear anyway (security first).

export const CLIPBOARD_CLEAR_MS = 30_000;

let pending: { value: string; timer: number; cleanup?: () => void } | null = null;

async function clearIfStillOurs(value: string): Promise<boolean> {
  try {
    const current = await navigator.clipboard.readText();
    if (current !== value) return true; // user copied something else; leave it
  } catch {
    /* no read permission: fall through and clear */
  }
  try {
    await navigator.clipboard.writeText('');
    return true;
  } catch {
    return false; // not focused; caller retries on focus
  }
}

function cancelPending() {
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pending.cleanup?.();
  pending = null;
}

/** Copies `value` and schedules a wipe. `onCleared` fires once wiped. */
export async function copySecret(value: string, onCleared?: () => void, delayMs = CLIPBOARD_CLEAR_MS): Promise<void> {
  await navigator.clipboard.writeText(value);
  cancelPending();

  const attempt = async () => {
    if (await clearIfStillOurs(value)) {
      cancelPending();
      onCleared?.();
      return;
    }
    // Couldn't write (tab not focused). Retry as soon as it is.
    const retry = () => {
      if (document.hasFocus()) void attempt();
    };
    window.addEventListener('focus', retry, { once: true });
    document.addEventListener('visibilitychange', retry, { once: true });
    if (pending) {
      pending.cleanup = () => {
        window.removeEventListener('focus', retry);
        document.removeEventListener('visibilitychange', retry);
      };
    }
  };

  pending = { value, timer: window.setTimeout(attempt, delayMs) };
}

/** Wipe now (vault locked, user signed out, page leaving). */
export async function clearCopiedSecretNow(): Promise<void> {
  if (!pending) return;
  const { value } = pending;
  cancelPending();
  await clearIfStillOurs(value);
}

/** Copy something that isn't secret (a username) — no timer, no wipe. */
export async function copyPlain(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

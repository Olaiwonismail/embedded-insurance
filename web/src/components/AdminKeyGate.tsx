import { FormEvent, useState } from 'react';

// Kept for this browser tab only; closing the tab forgets it.
const KEY_STORAGE = 'insureongo.adminKey';

export function readSavedKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function saveKey(key: string) {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage blocked: the key still works until the page reloads.
  }
}

// Asks for the admin key before any admin page shows.
export function KeyGate({ rejected, onSubmit }: { rejected: boolean; onSubmit: (key: string) => void }) {
  const [value, setValue] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  }

  return (
    <main className="gate">
      <form className="gate__card" onSubmit={submit}>
        <p className="brand">insureOnGo</p>
        <h1>Merchant review</h1>
        {rejected && (
          <p className="alert alert--error" role="alert">
            That admin key wasn't accepted. Check it and try again.
          </p>
        )}
        <div className="field">
          <label htmlFor="admin-key">Admin key</label>
          <p className="field__hint">The ADMIN_API_KEY value from the server's settings.</p>
          <input
            id="admin-key"
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </div>
        <button type="submit" className="btn btn--primary btn--wide">
          Open merchant list
        </button>
      </form>
    </main>
  );
}

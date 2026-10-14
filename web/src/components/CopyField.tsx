import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  value: string;
  hint?: string;
  secret?: boolean;
}

// A key shown in full with a copy button. Falls back to selecting the text
// when the clipboard API is unavailable, so it can still be copied by hand.
export function CopyField({ label, value, hint, secret }: Props) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(codeRef.current!);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  return (
    <div className={secret ? 'copy-field copy-field--secret' : 'copy-field'}>
      <div className="copy-field__head">
        <span className="copy-field__label">{label}</span>
        <button type="button" className="btn btn--small" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <code ref={codeRef} className="copy-field__value">
        {value}
      </code>
      {hint && <p className="copy-field__hint">{hint}</p>}
      <span className="visually-hidden" aria-live="polite">
        {copied ? `${label} copied` : ''}
      </span>
    </div>
  );
}

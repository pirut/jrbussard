/* Small shared pieces for the nest screens: sheets, buttons, copy, confirm. */

import React, { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/* A paper sheet that slides up over the burrow. Closing goes back home. */
export function Sheet({ title, kicker, children, onClose, tone = 'paper', className = '', labelledBy }) {
  const navigate = useNavigate();
  const close = onClose || (() => navigate('/nest'));
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    ref.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="nest-sheet-wrap" role="presentation">
      <button type="button" className="nest-sheet-scrim" aria-label="Back to the burrow" onClick={close} />
      <section ref={ref} tabIndex={-1} className={`nest-sheet nest-sheet-${tone} ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy || id}>
        <header className="nest-sheet-head">
          <span className="nest-sheet-grip" aria-hidden="true" />
          <div>
            {kicker && <p className="nest-kicker">{kicker}</p>}
            <h1 id={labelledBy || id}>{title}</h1>
          </div>
          <button type="button" className="nest-icon-btn" onClick={close} aria-label="Close">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className="nest-sheet-body">{children}</div>
      </section>
    </div>
  );
}

export const Button = React.forwardRef(function Button({ children, busy, variant = 'primary', className = '', disabled, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={`nest-button nest-button-${variant} ${className}`} disabled={busy || disabled} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="nest-dots" aria-label="Working"><i /><i /><i /></span> : children}
    </button>
  );
});

export function Toggle({ checked, onChange, label, hint, disabled }) {
  const id = useId();
  return (
    <label className="nest-toggle" htmlFor={id}>
      <span>
        <span className="nest-toggle-label">{label}</span>
        {hint && <span className="nest-hint">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="nest-switch" aria-hidden="true" />
    </label>
  );
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* fall back */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

export function CopyField({ value, label = 'Link' }) {
  const [state, setState] = useState('idle');
  return (
    <div className="nest-copy">
      <span className="nest-hint">{label}</span>
      <code className="nest-copy-value">{value}</code>
      <Button variant="soft" onClick={async () => setState((await copyText(value)) ? 'copied' : 'failed')}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy'}
      </Button>
    </div>
  );
}

export function NfcSteps() {
  return (
    <ol className="nest-steps">
      <li>Open <b>NFC Tools</b> (free, by wakdev) → <b>Write</b> → <b>Add a record</b> → <b>URL/URI</b>.</li>
      <li>Paste the whole link, including the part after <b>#</b>. Tap <b>OK</b>.</li>
      <li>Tap <b>Write</b> and hold the top of your iPhone to the tag until it confirms.</li>
      <li>Keep the link private. Anyone signed in with it could knock.</li>
    </ol>
  );
}

export function Notice({ children, tone = 'soft', onRetry }) {
  if (!children) return null;
  return (
    <div className={`nest-notice nest-notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onRetry && <button type="button" className="nest-link" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Quiet({ children }) {
  return <p className="nest-quiet">{children}</p>;
}

export function Loading({ label = 'Listening…' }) {
  return (
    <div className="nest-loading" role="status">
      <span className="nest-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="nest-sr">{label}</span>
    </div>
  );
}

/* A confirm dialog. Resolve with the button. */
export function Confirm({ title, body, confirmLabel, cancelLabel = 'Keep it', danger, onConfirm, onCancel, busy }) {
  const id = useId();
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="nest-confirm-wrap" role="presentation">
      <div className="nest-confirm" role="alertdialog" aria-modal="true" aria-labelledby={id}>
        <h2 id={id}>{title}</h2>
        {body && <div className="nest-confirm-body">{body}</div>}
        <div className="nest-confirm-actions">
          <Button ref={ref} variant="soft" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export function when(at, now = Date.now()) {
  if (!at) return '';
  const d = new Date(at);
  const diff = now - at;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const yesterday = new Date(now - 86400000).toDateString() === d.toDateString();
  if (yesterday) return `yesterday, ${time}`;
  const sameYear = new Date(now).getFullYear() === d.getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

export function dayLabel(day) {
  /* 'YYYY-MM-DD' → 'Tuesday, March 3' (no timezone shift). */
  const [y, m, d] = String(day).split('-').map(Number);
  if (!y || !m || !d) return day;
  const dt = new Date(y, m - 1, d);
  const sameYear = new Date().getFullYear() === y;
  return dt.toLocaleDateString([], sameYear ? { weekday: 'long', month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' });
}

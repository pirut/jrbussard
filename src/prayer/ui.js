import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, LoaderCircle, Heart, ArrowRight } from 'lucide-react';

export const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase() || 'T';
export const dateLabel = time => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(time);
export const relativeTime = time => {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hours ago`;
  if (minutes < 2880) return 'Yesterday';
  return dateLabel(time);
};
export function errorMessage(error) {
  if (typeof error?.data === 'string') return error.data;
  return 'That could not be saved. Please try again.';
}
export function Button({ children, className = '', variant = 'primary', busy, ...props }) {
  return <button {...props} disabled={busy || props.disabled} className={`tg-button tg-${variant} ${className}`}>{busy && <LoaderCircle size={17} className="tg-spin" />}{children}</button>;
}
export function Avatar({ name, small }) { return <span aria-hidden="true" className={`tg-avatar ${small ? 'tg-avatar-small' : ''}`}>{initials(name)}</span>; }
export function Field({ label, children, hint }) { return <label className="tg-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function ErrorNotice({ children }) { return children ? <p className="tg-error" role="alert">{children}</p> : null; }
export function Loading({ label = 'Gathering your prayer board…' }) { return <div className="tg-loading" role="status"><LoaderCircle className="tg-spin" size={23} /><span>{label}</span></div>; }
export function Empty({ title, children, action }) { return <div className="tg-empty"><span className="tg-empty-icon"><Heart size={25} strokeWidth={1.25} /></span><h2>{title}</h2><p>{children}</p>{action}</div>; }
export function Modal({ title, description, children, onClose, wide = false }) {
  return <Dialog.Root open onOpenChange={open => !open && onClose()}><Dialog.Portal><Dialog.Overlay className="tg-overlay" /><Dialog.Content className={`tg-modal tg-surface ${wide ? 'tg-modal-wide' : ''}`}><Dialog.Title>{title}</Dialog.Title><Dialog.Description className="tg-muted">{description}</Dialog.Description><Dialog.Close className="tg-close" aria-label="Close"><X size={21} /></Dialog.Close>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function Confirm({ title, description, actionLabel, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title={title} description={description} onClose={() => !busy && onClose()}><ErrorNotice>{error}</ErrorNotice><div className="tg-form-actions"><Button variant="quiet" onClick={onClose} disabled={busy}>Cancel</Button><Button busy={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>{actionLabel}<ArrowRight size={16} /></Button></div></Modal>;
}

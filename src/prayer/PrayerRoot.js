import React, { useEffect, useState } from 'react';
import { ConvexReactClient, useConvexAuth, useMutation, useQuery, useAction } from 'convex/react';
import { ConvexAuthProvider, useAuthActions } from '@convex-dev/auth/react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, LockKeyhole, ArrowLeft, Mail } from 'lucide-react';
import { prayerApi } from './data';
import { prayerHome } from './location';
import { Button, Field, ErrorNotice, Loading, errorMessage } from './ui';
import PrayerApp from './PrayerApp';
import olive from './olive.webp';
import './prayer.css';

const backendUrl = process.env.REACT_APP_PRAYER_CONVEX_URL;
const client = backendUrl ? new ConvexReactClient(backendUrl) : null;

class PrayerBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="tg-surface tg-recovery"><h1>Let’s reconnect.</h1><p>Your prayer board couldn’t load. Your saved requests are safe.</p><Button onClick={() => window.location.reload()}>Try again</Button></div> : this.props.children; }
}
export function WelcomeFrame({ children }) {
  return <div className="tg-surface tg-welcome"><a className="tg-brand" href={prayerHome()}>Together<span className="tg-brand-dot">.</span></a><div className="tg-welcome-grid"><section className="tg-welcome-copy"><h1>Carry one<br />another.</h1><span className="tg-gold-rule" /><p>A place to share, pray, and see God at work.</p><img src={olive} alt="" className="tg-welcome-olive" /><div className="tg-welcome-note"><LockKeyhole size={18} /><span>A private space for our Bible study.<br />Shared with care. Held in prayer.</span></div></section><section className="tg-signin">{children}</section></div><footer className="tg-welcome-footer">A little closer, even between gatherings.</footer></div>;
}
function SignIn() {
  const { signIn } = useAuthActions();
  const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); try { await signIn('resend', sent ? { email: email.trim().toLowerCase(), code: code.trim() } : { email: email.trim().toLowerCase() }); setSent(true); } catch { setError(sent ? 'That code could not be verified. Check it and try again, or request a new code.' : 'We couldn’t send your sign-in code. Please try again in a moment.'); } finally { setBusy(false); } }
  return <WelcomeFrame><span className="tg-signin-icon"><Mail size={25} strokeWidth={1.3} /></span><h2>{sent ? 'Check your inbox.' : 'Come as you are.'}</h2><p className="tg-muted">{sent ? `Enter the sign-in code sent to ${email}.` : 'Sign in to share what’s on your heart and pray with your group.'}</p><form onSubmit={submit}><Field label={sent ? 'Sign-in code' : 'Your email'}>{sent ? <input autoFocus autoComplete="one-time-code" inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} required maxLength={12} placeholder="Enter your code" /> : <input autoFocus type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} placeholder="you@example.com" />}</Field><ErrorNotice>{error}</ErrorNotice><Button className="tg-full" type="submit" busy={busy}>{sent ? 'Join your group' : 'Email me a sign-in code'}<ArrowRight size={18} /></Button></form>{sent ? <button className="tg-text-button" onClick={() => { setSent(false); setCode(''); setError(''); }}><ArrowLeft size={15} />Use another email or request a new code</button> : <p className="tg-fine">No password to remember. You’ll need an invitation to join the group.</p>}</WelcomeFrame>;
}
function Join({ viewer }) {
  const [params, setParams] = useSearchParams();
  const [name, setName] = useState(viewer.name || ''); const [token, setToken] = useState(params.get('invite') || ''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const redeem = useAction(prayerApi.redeemInvite); const initialize = useMutation(prayerApi.initialize); const { signOut } = useAuthActions();
  return <WelcomeFrame><h2>{viewer.canInitialize ? 'Make room for your group.' : 'You’re almost here.'}</h2><p className="tg-muted">{viewer.canInitialize ? 'Create your private Bible study space. You’ll be its owner and can invite everyone in.' : 'Use the invitation your group leader shared with you.'}</p><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { if (viewer.canInitialize) await initialize({ name: 'JR Bussard' }); else await redeem({ token: token.trim(), name: name.trim() }); params.delete('invite'); setParams(params, { replace: true }); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }}>{!viewer.canInitialize && <><Field label="Your name"><input required maxLength={60} value={name} onChange={e => setName(e.target.value)} autoComplete="name" /></Field><Field label="Invitation code" hint="Ask your leader for an invite link if you don’t have one."><input required value={token} onChange={e => { const value = e.target.value; try { setToken(new URL(value).searchParams.get('invite') || value); } catch { setToken(value); } }} autoComplete="off" /></Field></>}<ErrorNotice>{error}</ErrorNotice><Button type="submit" className="tg-full" busy={busy}>{viewer.canInitialize ? 'Create our prayer board' : 'Accept invitation'}<ArrowRight size={18} /></Button></form><button className="tg-text-button" onClick={() => signOut()}>Signed in as {viewer.email} · Sign out</button></WelcomeFrame>;
}
function Gate() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const viewer = useQuery(prayerApi.viewer, isAuthenticated ? {} : 'skip');
  if (isLoading || (isAuthenticated && viewer === undefined)) return <div className="tg-surface"><Loading /></div>;
  if (!isAuthenticated) return <SignIn />;
  if (!viewer) return <div className="tg-surface"><Loading label="Connecting your account…" /></div>;
  if (!viewer.member) return <Join viewer={viewer} />;
  return <PrayerApp viewer={viewer} />;
}
export default function PrayerRoot() {
  useEffect(() => { const title = document.title; document.title = 'Together · Our prayer board'; document.body.classList.add('tg-body'); const meta = document.querySelector('meta[name="color-scheme"]'); const old = meta?.content; if (meta) meta.content = 'light'; return () => { document.title = title; document.body.classList.remove('tg-body'); if (meta) meta.content = old; }; }, []);
  return <PrayerBoundary>{client ? <ConvexAuthProvider client={client} storageNamespace="together-prayer"><Gate /></ConvexAuthProvider> : <WelcomeFrame><h2>A place for our prayers.</h2><p className="tg-muted">Our private prayer board is being prepared. Your group leader will share an invitation when it’s ready.</p><div className="tg-soft-note"><LockKeyhole size={20} />Prayer requests will only be visible to invited members.</div></WelcomeFrame>}</PrayerBoundary>;
}

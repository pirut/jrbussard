/* /nest/touch/:tagId#<secret>: the NFC landing.

   The secret was read and cleared from the address bar on load (see
   session.js), before any sign-in. Once signed in we call touch.begin once,
   hand the moment to the burrow, and go home. The burrow shows the
   fallbackText at once and swaps in the real line when it arrives. */

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../api';
import { useNestMutation, useSession } from '../context';
import { consumeTouchSecret, peekSecrets, subscribeSecrets } from '../session';
import { errorCode, errorText } from '../errors';
import { Button } from '../ui';

export function touchErrorText(e) {
  const code = errorCode(e);
  if (code === 'bad_tag') return 'This tag doesn’t open this nest anymore.';
  if (code === 'busy') return 'The nest is being restored. Try again in a minute.';
  if (code === 'rate_limited') return 'Easy. It heard you.';
  return errorText(e, 'The knock didn’t carry. Try again.');
}

/* Begin a touch: call once, return the moment for the burrow.
   A bad tag is an answer ({ ok: false, code }), not a throw. */
export async function beginTouch(begin, tagId, secret, now = Date.now()) {
  const out = await begin({ tagId, secret, clientTime: now });
  if (out && out.ok === false) {
    const err = new Error(out.message || 'bad tag');
    err.data = { code: out.code || 'bad_tag', message: out.message };
    throw err;
  }
  return { kind: out.momentKind, fallbackText: out.fallbackText, messageId: out.messageId, jobId: out.jobId, visitId: out.visitId, at: now };
}

function TouchLanding() {
  const { tagId } = useParams();
  const { setMoment } = useOutletContext() || {};
  const begin = useNestMutation(api.touch.begin);
  const { signOut } = useSession();
  const navigate = useNavigate();
  const secret = useRef(undefined);
  if (secret.current === undefined) {
    /* Peek, not take: React may render twice before the effect runs. */
    const pending = peekSecrets().touch;
    secret.current = pending && pending.tagId === tagId ? pending.secret : null;
  }
  const started = useRef(false);
  const [error, setError] = useState(secret.current ? '' : 'none');

  const run = useCallback(async () => {
    setError('');
    try {
      const m = await beginTouch(begin, tagId, secret.current);
      consumeTouchSecret(tagId);
      setMoment?.(m);
      navigate('/nest', { replace: true });
    } catch (e) {
      if (errorCode(e) === 'unauthenticated') { signOut(); return; }
      setError(touchErrorText(e));
      if (errorCode(e) === 'bad_tag') { consumeTouchSecret(tagId); secret.current = null; }
    }
  }, [begin, tagId, setMoment, navigate, signOut]);

  useEffect(() => {
    if (started.current || !secret.current) return;
    started.current = true;
    run();
  }, [run]);

  if (!error) return <div className="nest-knock" aria-label="Knocking" role="status"><span /><span /><span /></div>;
  return (
    <div className="nest-touch-note" role="alert">
      <p>{error === 'none' ? 'Touch its home again to come in.' : error}</p>
      <div className="nest-form-row">
        {error !== 'none' && secret.current && <Button onClick={run}>Try again</Button>}
        <Button variant="soft" onClick={() => navigate('/nest', { replace: true })}>Look through the window</Button>
      </div>
    </div>
  );
}

const touchStamp = () => peekSecrets().touch?.at || 0;

/* Safari reuses the tab when the tag is touched again: only the fragment
   changes, so nothing remounts. Key the landing on the stored secret's stamp
   so each new touch runs once, on its own secret. The key only moves forward
   (spending a secret must not remount a landing that is about to go home). */
export default function TouchRoute() {
  const { tagId } = useParams();
  const at = useSyncExternalStore(subscribeSecrets, touchStamp);
  const seen = useRef(at);
  if (at && at !== seen.current) seen.current = at;
  return <TouchLanding key={`${tagId}:${seen.current}`} />;
}

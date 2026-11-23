/* /nest/claim#<code>: the code was read and cleared from the address bar on
   load. One tap registers a passkey (Face ID), stores the session, and goes
   home. Device links use the same route. */

import React, { useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { useNavigate } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import { api } from '../api';
import { useSession } from '../context';
import { errorCode, errorText } from '../errors';
import { Button, Notice } from '../ui';
import { consumeClaimCode } from '../session';
import { DoorScene, deviceLabel } from './Door';

export function claimErrorText(e) {
  const code = errorCode(e);
  if (code === 'expired') return 'This key has gone cold. Ask for a new link.';
  if (code === 'rate_limited') return 'That took too many tries. Wait a moment, then try again.';
  if (code === 'claimed') return 'This nest already has someone.';
  if (code === 'unclaimed') return 'There is no one here yet to add a device for.';
  if (code === 'duplicate') return 'This device already has a key. Sign in instead.';
  if (code === 'misconfigured') return 'The nest is not set up for this address yet.';
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return 'Face ID was cancelled. Try again when you are ready.';
  if (e?.name === 'InvalidStateError') return 'This device already has a key. Sign in instead.';
  return errorText(e, 'The door did not open. Try again.');
}

export default function Claim({ code: given }) {
  /* The code is spent after a good register; keep showing this screen. */
  const held = useRef(given);
  if (given) held.current = given;
  const code = held.current;
  const { setToken } = useSession();
  const navigate = useNavigate();
  const registrationOptions = useAction(api.authNode.registrationOptions);
  const register = useAction(api.authNode.register);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  if (!code) {
    return (
      <DoorScene glow={0.2}>
        <p className="nest-door-line">This key has no teeth.</p>
        <p className="nest-door-sub">Open the whole link you were given, on this phone.</p>
      </DoorScene>
    );
  }

  const claim = async () => {
    setBusy(true);
    setError('');
    try {
      const { challengeId, options, purpose } = await registrationOptions({ claimCode: code });
      const response = await startRegistration({ optionsJSON: options });
      const out = await register({ claimCode: code, challengeId, response, label: deviceLabel() });
      consumeClaimCode();
      setDone(out.purpose || purpose);
      setToken(out.sessionToken);
      setTimeout(() => navigate('/nest', { replace: true }), 900);
    } catch (e) {
      setError(claimErrorText(e));
      setBusy(false);
    }
  };

  return (
    <DoorScene glow={done ? 1 : 0.55}>
      {done ? (
        <p className="nest-door-line" role="status">The door opens.</p>
      ) : (
        <>
          <p className="nest-door-line">A key, warm from someone’s pocket.</p>
          <Button onClick={claim} busy={busy} className="nest-door-btn">Open with Face ID</Button>
          <p className="nest-door-sub">Your face stays on your phone. The nest only learns this device.</p>
          <Notice tone="error">{error}</Notice>
        </>
      )}
    </DoorScene>
  );
}

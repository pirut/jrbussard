/* Session context and small hooks shared by every screen. */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useConvex, useMutation, useAction, useQuery, usePaginatedQuery } from 'convex/react';
import { readSession, writeSession, SESSION_KEY } from './session';

const SessionContext = createContext({ token: null, setToken: () => {}, signOut: () => {} });

export function SessionProvider({ children }) {
  const [token, setTokenState] = useState(() => readSession());
  const setToken = useCallback((t) => {
    writeSession(t);
    setTokenState(t || null);
  }, []);
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === SESSION_KEY) setTokenState(e.newValue || null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const value = useMemo(() => ({ token, setToken, signOut: () => setToken(null) }), [token, setToken]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}

/* useQuery with the session token filled in; 'skip' passes through. */
export function useNestQuery(ref, args = {}) {
  const { token } = useSession();
  return useQuery(ref, args === 'skip' || !token ? 'skip' : { sessionToken: token, ...args });
}

export function useNestPaginated(ref, args, initialNumItems) {
  const { token } = useSession();
  return usePaginatedQuery(ref, args === 'skip' || !token ? 'skip' : { sessionToken: token, ...args }, { initialNumItems });
}

/* Mutation/action callers that add the session token. */
export function useNestMutation(ref) {
  const { token } = useSession();
  const m = useMutation(ref);
  return useCallback((args = {}) => m({ sessionToken: token, ...args }), [m, token]);
}

export function useNestAction(ref) {
  const { token } = useSession();
  const a = useAction(ref);
  return useCallback((args = {}) => a({ sessionToken: token, ...args }), [a, token]);
}

/* Online or not: the browser's view plus the Convex websocket. We only
   call it offline after a short grace, so a reconnect blip shows nothing. */
export function useConnection(graceMs = 3500) {
  const convex = useConvex();
  const [online, setOnline] = useState(true);
  const timer = useRef(0);
  useEffect(() => {
    let socketUp = true;
    let browserUp = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
    const update = () => {
      const up = socketUp && browserUp;
      clearTimeout(timer.current);
      if (up) setOnline(true);
      else timer.current = setTimeout(() => setOnline(false), graceMs);
    };
    let unsub = () => {};
    if (typeof convex?.subscribeToConnectionState === 'function') {
      unsub = convex.subscribeToConnectionState((s) => {
        socketUp = !!s.isWebSocketConnected || (s.connectionRetries === 0 && !s.hasEverConnected);
        update();
      });
    }
    const on = () => { browserUp = true; update(); };
    const off = () => { browserUp = false; update(); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    update();
    return () => {
      unsub();
      clearTimeout(timer.current);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, [convex, graceMs]);
  return online;
}

/* A value that ticks every `ms` (for countdowns). */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

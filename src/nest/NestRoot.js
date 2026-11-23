/* /nest/*: the creature's home. Its own Convex client (nest-creature),
   a passkey session in localStorage, and the burrow with its sheets. */

import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { ConvexProvider, ConvexReactClient, useQuery } from 'convex/react';
import { useNestFonts } from './visual/fonts';
import './visual/nest-visual.css';
import './nest-app.css';
import { api } from './api';
import { SessionProvider, useSession } from './context';
import { isUnauthenticated } from './errors';
import { takeFragmentSecrets, peekSecrets } from './session';
import Door from './screens/Door';
import Claim from './screens/Claim';
import Home from './screens/Home';
import TouchLanding from './screens/Touch';
import Journal from './screens/Journal';
import Memories from './screens/Memories';
import World from './screens/World';
import Settings from './screens/Settings';
import { Button } from './ui';

const Gallery = lazy(() => import('./visual/Gallery'));

const backendUrl = process.env.REACT_APP_NEST_CONVEX_URL;
const client = backendUrl ? new ConvexReactClient(backendUrl) : null;

/* The gallery is visual QA: open in development, or with ?gallery=1. */
function galleryAllowed(search) {
  return process.env.NODE_ENV !== 'production' || new URLSearchParams(search).get('gallery') === '1';
}

function GalleryGate() {
  const { search } = useLocation();
  if (!galleryAllowed(search)) return <Navigate to="/nest" replace />;
  return <Suspense fallback={<Door mode="loading" />}><Gallery /></Suspense>;
}

/* Anything that throws while rendering lands here, never on a blank page. */
export class NestBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) {
    if (isUnauthenticated(error)) this.props.onUnauthenticated?.();
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (isUnauthenticated(error)) {
      return <Door mode="signin" />;
    }
    return (
      <div className="nest-recover" role="alert">
        <h1>The lantern flickered.</h1>
        <p>Something went wrong on this page. It is safe; nothing was lost.</p>
        <Button onClick={() => { this.setState({ error: null }); }}>Try again</Button>
        <button type="button" className="nest-link" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}

/* Decide between the door and the burrow. */
export function gateState({ token, status, session }) {
  if (token) {
    if (session === undefined) return 'loading';
    if (session?.valid) return 'in';
  }
  if (status === undefined) return 'loading';
  return status?.claimed ? 'signin' : 'unclaimed';
}

function Gate() {
  const { token, signOut } = useSession();
  const location = useLocation();
  const status = useQuery(api.public.status, {});
  const session = useQuery(api.auth.session, token ? { sessionToken: token } : 'skip');
  useEffect(() => {
    if (token && session && session.valid === false) signOut();
  }, [token, session, signOut]);

  if (location.pathname.replace(/\/+$/, '') === '/nest/claim') {
    return <Claim code={peekSecrets().claim} />;
  }
  const state = gateState({ token, status, session });
  if (state === 'loading') return <Door mode="loading" />;
  if (state !== 'in') return <Door mode={state} />;
  return (
    <NestBoundary key={token} onUnauthenticated={signOut}>
      <Routes>
        <Route element={<Home />}>
          <Route index element={null} />
          <Route path="touch/:tagId" element={<TouchLanding />} />
          <Route path="journal" element={<Journal />} />
          <Route path="memories" element={<Memories />} />
          <Route path="world" element={<World />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/nest" replace />} />
        </Route>
      </Routes>
    </NestBoundary>
  );
}

/* Home-screen app meta, only while on /nest. */
function useNestDocument() {
  useEffect(() => {
    const title = document.title;
    document.title = 'The nest';
    const added = [];
    const set = (tag, attrs) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      el.setAttribute('data-nest', '');
      document.head.appendChild(el);
      added.push(el);
    };
    set('link', { rel: 'manifest', href: '/nest.webmanifest' });
    set('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
    set('meta', { name: 'mobile-web-app-capable', content: 'yes' });
    set('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' });
    set('meta', { name: 'apple-mobile-web-app-title', content: 'Nest' });
    /* iOS uses the page's apple-touch-icon when added to the home screen. */
    const touchIcon = document.querySelector('link[rel="apple-touch-icon"]');
    const oldIcon = touchIcon?.getAttribute('href');
    if (touchIcon) touchIcon.setAttribute('href', '/nest-icon-180.png');
    else set('link', { rel: 'apple-touch-icon', href: '/nest-icon-180.png' });
    const theme = document.querySelector('meta[name="theme-color"]:not([data-nest])');
    const oldTheme = theme?.content;
    if (theme) theme.content = '#1a1418';
    const viewport = document.querySelector('meta[name="viewport"]');
    const oldViewport = viewport?.content;
    if (viewport) viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    document.documentElement.classList.add('nest-doc');
    return () => {
      document.title = title;
      added.forEach((el) => el.remove());
      if (theme) theme.content = oldTheme;
      if (viewport) viewport.content = oldViewport;
      if (touchIcon && oldIcon) touchIcon.setAttribute('href', oldIcon);
      document.documentElement.classList.remove('nest-doc');
    };
  }, []);
}

export default function NestRoot() {
  useNestFonts();
  useNestDocument();
  /* Read and clear claim codes and tag secrets from the address bar at once. */
  useState(() => takeFragmentSecrets());
  useEffect(() => {
    const onHash = () => takeFragmentSecrets();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return (
    <div className="nest-root">
      <Routes>
        <Route path="gallery" element={<GalleryGate />} />
        <Route
          path="*"
          element={client ? (
            <ConvexProvider client={client}>
              <SessionProvider>
                <NestBoundary>
                  <Gate />
                </NestBoundary>
              </SessionProvider>
            </ConvexProvider>
          ) : <Door mode="unconfigured" />}
        />
      </Routes>
    </div>
  );
}

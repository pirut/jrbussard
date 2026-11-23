import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { useNestFonts } from './visual/fonts';
import './visual/nest-visual.css';

const Gallery = lazy(() => import('./visual/Gallery'));

/* The gallery is visual QA: open in development, or with ?gallery=1. */
function galleryAllowed(search) {
  return process.env.NODE_ENV !== 'production' || new URLSearchParams(search).get('gallery') === '1';
}

function Placeholder() {
  return (
    <main className="nest-placeholder">
      <div>
        <h1>The nest is being built.</h1>
        <p>Something small will live here soon.</p>
      </div>
    </main>
  );
}

function GalleryGate() {
  const { search } = useLocation();
  if (!galleryAllowed(search)) return <Placeholder />;
  return <Suspense fallback={<Placeholder />}><Gallery /></Suspense>;
}

export default function NestRoot() {
  useNestFonts();
  useEffect(() => {
    const title = document.title;
    document.title = 'The nest';
    return () => { document.title = title; };
  }, []);
  return (
    <div className="nest-root">
      <Routes>
        <Route path="gallery" element={<GalleryGate />} />
        <Route path="*" element={<Placeholder />} />
      </Routes>
    </div>
  );
}

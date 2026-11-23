import React, { lazy, Suspense } from "react";
import World from "./pages/World";
import NotFound from "./pages/NotFound";
import { microfrontends } from "./microfrontends/registry";
import { isPrayerHost } from './prayer/location';
const Prayer = lazy(() => import('./prayer/PrayerRoot'));
const ContactPage = lazy(() => import('./contact/ContactPage'));
const contactElement = <Suspense fallback={<div role="status" style={{background:'#101713',color:'#e8e6d3',height:'100vh'}} />}><ContactPage /></Suspense>;
const prayerElement = <Suspense fallback={<div role="status" style={{background:'#faf8f3',color:'#284f43',height:'100%',display:'grid',placeItems:'center'}}>Opening Together…</div>}><Prayer /></Suspense>;

export const routes = isPrayerHost(window.location.hostname) ? [
    { path: '/*', element: prayerElement },
] : [
    { path: '/prayer/*', element: prayerElement },
    { path: '/contact', element: contactElement },
    { path: '/contact/:slug', element: contactElement },
    {
        path: "/",
        element: <World />,
    },
    ...microfrontends.map((app) => ({ path: app.route, element: app.element })),
    { path: "*", element: <NotFound /> },
];

import React, { lazy, Suspense } from "react";
import World from "./pages/World";
import { microfrontends } from "./microfrontends/registry";
import { isPrayerHost } from './prayer/location';
const Prayer = lazy(() => import('./prayer/PrayerRoot'));
const prayerElement = <Suspense fallback={<div role="status" style={{background:'#faf8f3',color:'#284f43',height:'100%',display:'grid',placeItems:'center'}}>Opening Together…</div>}><Prayer /></Suspense>;

export const routes = isPrayerHost(window.location.hostname) ? [
    { path: '/*', element: prayerElement },
] : [
    { path: '/prayer/*', element: prayerElement },
    {
        path: "/",
        element: <World />,
    },
    ...microfrontends.map((app) => ({ path: app.route, element: app.element })),
];

import React, { lazy, Suspense } from "react";
import World from "./pages/World";
import { microfrontends } from "./microfrontends/registry";
const DesignPreview = lazy(() => import('./prayer/DesignPreview'));
const Prayer = lazy(() => import('./prayer/PrayerRoot'));

export const routes = [
    {path: '/together-design', element:<Suspense fallback={null}><DesignPreview /></Suspense>},
    { path: '/prayer/*', element: <Suspense fallback={<div role="status" style={{background:'#faf8f3',color:'#284f43',height:'100%',display:'grid',placeItems:'center'}}>Opening Together…</div>}><Prayer /></Suspense> },
    {
        path: "/",
        element: <World />,
    },
    ...microfrontends.map((app) => ({ path: app.route, element: app.element })),
];

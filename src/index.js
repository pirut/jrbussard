import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider } from "convex/react";
import "./index.css";
import App from "./App";
import { convex } from "./lib/convex";

const root = ReactDOM.createRoot(document.getElementById("root"));

/* Only the Commons talks to Convex; without it the rest of the site is
   unaffected, so the provider is optional. */
const tree = convex ? (
    <ConvexProvider client={convex}>
        <App />
    </ConvexProvider>
) : (
    <App />
);

root.render(<React.StrictMode>{tree}</React.StrictMode>);

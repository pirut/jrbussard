import React from "react";

/* Shown while a route's chunk is on its way. */
export default function Loading({ label = "loading" }) {
    return (
        <div className="loading" role="status" aria-live="polite">
            <span className="loading__mark" aria-hidden="true">
                ▸
            </span>
            {label}
        </div>
    );
}

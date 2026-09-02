import React from "react";

export default function Loading({ label = "Loading" }) {
    return (
        <div className="loading" role="status" aria-live="polite">
            <div>
                <i aria-hidden="true" />
                {label}
            </div>
        </div>
    );
}

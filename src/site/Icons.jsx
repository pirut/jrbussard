import React from "react";

const base = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
};

export const Mark = ({ size = 34, ...rest }) => (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" {...rest}>
        <rect width="64" height="64" rx="12" fill="#141416" />
        <path
            d="M14 13h12v25c0 9-4 14-13 14H9V42h3c2 0 2-1 2-4V13Zm17 0h13c9 0 14 5 14 13 0 5-2 8-6 10 5 2 7 6 7 12v4H47v-5c0-4-2-6-6-6h-1v11H29V13h2Zm9 10v9h3c3 0 4-2 4-5s-1-4-4-4h-3Z"
            fill="#f3efe7"
        />
        <rect x="8" y="8" width="8" height="8" fill="#d9a95b" />
    </svg>
);

export const Sun = () => (
    <svg {...base}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
);

export const Moon = () => (
    <svg {...base}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
);

export const Menu = () => (
    <svg {...base}>
        <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
);

export const Close = () => (
    <svg {...base}>
        <path d="M6 6l12 12M18 6L6 18" />
    </svg>
);

export const ArrowUpRight = () => (
    <svg {...base} width={14} height={14}>
        <path d="M7 17L17 7M8 7h9v9" />
    </svg>
);

export const GitHub = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2.2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5Z" />
    </svg>
);

export const LinkedIn = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.4 2H3.6A1.6 1.6 0 0 0 2 3.6v16.8A1.6 1.6 0 0 0 3.6 22h16.8a1.6 1.6 0 0 0 1.6-1.6V3.6A1.6 1.6 0 0 0 20.4 2ZM8 19H5V9h3v10ZM6.5 7.7A1.7 1.7 0 1 1 6.5 4.3a1.7 1.7 0 0 1 0 3.4ZM19 19h-3v-4.9c0-1.2 0-2.7-1.6-2.7s-1.9 1.3-1.9 2.6V19h-3V9h2.9v1.4a3.2 3.2 0 0 1 2.8-1.5c3 0 3.6 2 3.6 4.6V19Z" />
    </svg>
);

export const Mail = () => (
    <svg {...base}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
    </svg>
);

export const Star = () => (
    <svg {...base} width={14} height={14}>
        <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z" />
    </svg>
);

export const Copy = () => (
    <svg {...base} width={14} height={14}>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
);

export const Check = () => (
    <svg {...base} width={14} height={14}>
        <path d="m5 12 4 4L19 6" />
    </svg>
);

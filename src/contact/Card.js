import React, { useEffect, useState } from "react";
import { buildVCard } from "./vcard";

/*
 * The pieces every contact view shares: the noindex page shell, the card
 * itself and the quiet loading state. Deliberately light: no Three.js, no
 * world. Kept out of search results with a meta tag here and an
 * X-Robots-Tag header in vercel.json.
 */

function useNoIndex(title) {
    useEffect(() => {
        const meta = document.createElement("meta");
        meta.name = "robots";
        meta.content = "noindex, nofollow";
        document.head.appendChild(meta);
        const previous = document.title;
        document.title = title;
        return () => {
            meta.remove();
            document.title = previous;
        };
    }, [title]);
}

/* The page around a card or the editor. */
export function Shell({ title, children }) {
    useNoIndex(title || "Contact");
    return (
        <main className="cc">
            <div className="cc__col">{children}</div>
        </main>
    );
}

export function Loading() {
    return (
        <Shell>
            <p className="cc__loading" role="status">Loading…</p>
        </Shell>
    );
}

/* The card. `children` render at the bottom (the editor's controls). */
export function Card({ card, children }) {
    const [status, setStatus] = useState("");

    useEffect(() => {
        if (!status) return undefined;
        const timer = setTimeout(() => setStatus(""), 2000);
        return () => clearTimeout(timer);
    }, [status]);

    const saveContact = () => {
        const blob = new Blob([buildVCard(card)], { type: "text/vcard;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${card.slug}.vcf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    };

    const share = async () => {
        const url = window.location.origin + window.location.pathname;
        if (navigator.share) {
            try {
                await navigator.share({ title: `${card.name} · Contact`, url });
                return;
            } catch (err) {
                if (err && err.name === "AbortError") return;
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            setStatus("Copied");
        } catch (err) {
            setStatus("Copy failed");
        }
    };

    const sub = [card.title, card.company].filter(Boolean).join(" · ");
    const phone = card.phone ? card.phone.replace(/[^\d+]/g, "") : "";

    return (
        <article className="cc__card">
            <pre className="cc__art" aria-hidden="true">{"┌──────────┐\n│ ·· ▒▒ ·· │\n└──────────┘"}</pre>
            <h1 className="cc__name">{card.name}</h1>
            {sub && <p className="cc__sub">{sub}</p>}
            {card.location && <p className="cc__meta">{card.location}</p>}
            {card.note && <p className="cc__note">{card.note}</p>}

            <div className="cc__actions">
                {card.email && (
                    <a className="cc__btn cc__btn--primary" href={`mailto:${card.email}`}>
                        Email
                    </a>
                )}
                {phone && (
                    <>
                        <a className="cc__btn" href={`tel:${phone}`}>Call</a>
                        <a className="cc__btn" href={`sms:${phone}`}>Text</a>
                    </>
                )}
                <button type="button" className="cc__btn" onClick={saveContact}>
                    Save contact
                </button>
                <button type="button" className="cc__btn" onClick={share}>
                    Share
                </button>
            </div>
            <p className="cc__status" role="status" aria-live="polite">{status}</p>

            {card.email && <p className="cc__meta cc__email">{card.email}</p>}
            {card.links && card.links.length > 0 && (
                <ul className="cc__links">
                    {card.links.map((link, i) => (
                        <li key={`${i}:${link.href}`}>
                            <a href={link.href} target="_blank" rel="noopener noreferrer">
                                <span>{link.label}</span>
                                <span aria-hidden="true">↗</span>
                            </a>
                        </li>
                    ))}
                </ul>
            )}
            {children}
        </article>
    );
}

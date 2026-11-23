import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import NotFound from "../pages/NotFound";
import { findContactCard } from "../data/contactCards";
import { buildVCard } from "./vcard";
import "./contact.css";

/*
 * A small, private-ish contact card. Deliberately light: no Three.js, no world.
 * Kept out of search results with a meta tag here and an X-Robots-Tag header
 * in vercel.json.
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

function Card({ card }) {
    const [status, setStatus] = useState("");
    useNoIndex(`${card.name} · Contact`);

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
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const share = async () => {
        const url = window.location.href;
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
        <main className="cc">
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
                        {card.links.map((link) => (
                            <li key={link.href}>
                                <a href={link.href} target="_blank" rel="noopener noreferrer">
                                    <span>{link.label}</span>
                                    <span aria-hidden="true">↗</span>
                                </a>
                            </li>
                        ))}
                    </ul>
                )}
            </article>
        </main>
    );
}

export default function ContactPage() {
    const { slug } = useParams();
    const card = findContactCard(slug);
    return card ? <Card card={card} /> : <NotFound />;
}

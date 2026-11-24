import React, { Component, lazy, Suspense } from "react";
import { useLocation, useParams } from "react-router-dom";
import NotFound from "../pages/NotFound";
import { findContactCard } from "../data/contactCards";
import { convex } from "../lib/convex";
import { Card, Loading, Shell } from "./Card";
import { useContactCard } from "./useContactCard";
import { wantsEditor } from "./editorFlag";
import "./contact.css";

/*
 * /contact (JR) and /contact/<slug>. A small, private-ish contact card.
 *
 * Three ways it renders:
 *   - No Convex URL configured: only the built-in cards in
 *     src/data/contactCards.js (StaticContact).
 *   - Everyone else: the saved Convex card for the slug, falling back to the
 *     built-in one (PublicContact). `jr` shows its built-in card at once.
 *   - The editor's own browser (`?edit`, or after signing in once): the same
 *     card plus edit controls, in a separate lazy chunk (ContactAdmin) that
 *     carries Clerk. Public visitors never download it. Needs
 *     REACT_APP_CLERK_PUBLISHABLE_KEY; without it editing is simply off.
 *
 * If the Convex side fails (say the functions are not deployed yet) the
 * boundary drops back to the built-in cards rather than a blank page.
 */

const ContactAdmin = lazy(() => import("./ContactAdmin"));
const clerkKey = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

function StaticContact({ slug }) {
    const card = findContactCard(slug);
    if (!card) return <NotFound />;
    return (
        <Shell title={`${card.name} · Contact`}>
            <Card card={card} />
        </Shell>
    );
}

function PublicContact({ slug }) {
    const { card, loading } = useContactCard(slug);
    if (loading) return <Loading />;
    if (!card) return <NotFound />;
    return (
        <Shell title={`${card.name} · Contact`}>
            <Card card={card} />
        </Shell>
    );
}

class FallBackToStatic extends Component {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error) {
        console.error("Contact card: falling back to the built-in cards.", error);
    }
    render() {
        return this.state.failed ? <StaticContact slug={this.props.slug} /> : this.props.children;
    }
}

export default function ContactPage() {
    const { slug } = useParams();
    const { search } = useLocation();
    if (!convex) return <StaticContact slug={slug} />;
    const admin = Boolean(clerkKey) && wantsEditor(search);
    return (
        <FallBackToStatic key={slug || "jr"} slug={slug}>
            {admin ? (
                <Suspense fallback={<PublicContact slug={slug} />}>
                    <ContactAdmin slug={slug} publishableKey={clerkKey} />
                </Suspense>
            ) : (
                <PublicContact slug={slug} />
            )}
        </FallBackToStatic>
    );
}

import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ClerkProvider, useAuth, useClerk } from "@clerk/react";
import { useConvexAuth, useQuery } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import NotFound from "../pages/NotFound";
import { convex } from "../lib/convex";
import { isValidSlug } from "../lib/contactCard";
import { Card, Loading, Shell } from "./Card";
import CardEditor from "./CardEditor";
import { contactApi } from "./contactApi";
import { forgetEditor, hasEditParam, rememberEditor } from "./editorFlag";
import { useContactCard } from "./useContactCard";

/*
 * The contact page for its editor: the same card plus sign-in and edit
 * controls. Loaded lazily by ContactPage only for `?edit` or a browser that
 * signed in before, so Clerk never reaches public visitors or the home page.
 *
 * Signing in is Clerk (Google); Convex gets the Clerk session token through
 * ConvexProviderWithClerk. The server decides who may write (canEdit, and
 * every write re-checks); these controls only follow its answer.
 */

export default function ContactAdmin({ slug, publishableKey }) {
    return (
        <ClerkProvider publishableKey={publishableKey}>
            <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
                <AdminView key={slug || "jr"} slug={slug} />
            </ConvexProviderWithClerk>
        </ClerkProvider>
    );
}

function AdminView({ slug }) {
    const { isLoaded, isSignedIn } = useAuth();
    const { isLoading: convexAuthLoading } = useConvexAuth();
    const { search, state } = useLocation();
    const { slug: key, card, stored, loading, ready } = useContactCard(slug);
    const status = useQuery(
        contactApi.canEdit,
        isLoaded && isSignedIn && !convexAuthLoading ? {} : "skip"
    );
    const [editing, setEditing] = useState(Boolean(state && state.openEditor));

    const allowed = Boolean(isSignedIn && status && status.allowed);
    /* Signed out with no ?edit means the session ended: go back to public. */
    const showControls = hasEditParam(search) || (isLoaded && isSignedIn);
    useEffect(() => {
        if (isLoaded && !isSignedIn && !hasEditParam(search)) forgetEditor();
    }, [isLoaded, isSignedIn, search]);

    if (editing && (!isLoaded || (isSignedIn && status === undefined) || !ready)) return <Loading />;

    if (editing && allowed) {
        return (
            <Shell title={`Edit · ${card ? card.name : key}`}>
                <CardEditor
                    slug={key}
                    initial={card}
                    stored={Boolean(stored)}
                    onDone={() => setEditing(false)}
                />
            </Shell>
        );
    }

    const controls = showControls ? (
        <EditorBar
            isLoaded={isLoaded}
            isSignedIn={isSignedIn}
            status={status}
            hasCard={Boolean(card)}
            onEdit={() => setEditing(true)}
        />
    ) : null;

    if (loading) return <Loading />;
    if (!card) {
        if (!controls) return <NotFound />;
        return (
            <Shell title="Contact">
                <article className="cc__card">
                    <h1 className="cc__name">No card here yet</h1>
                    <p className="cc__meta">
                        Nothing is saved at <code>/contact/{key}</code>.
                    </p>
                    {controls}
                </article>
            </Shell>
        );
    }
    return (
        <Shell title={`${card.name} · Contact`}>
            <Card card={card}>{controls}</Card>
        </Shell>
    );
}

function EditorBar({ isLoaded, isSignedIn, status, hasCard, onEdit }) {
    const clerk = useClerk();
    const [creating, setCreating] = useState(false);

    const signIn = () => {
        rememberEditor();
        const back = window.location.href;
        clerk.openSignIn({ forceRedirectUrl: back, signUpForceRedirectUrl: back });
    };
    const signOut = () => {
        forgetEditor();
        clerk.signOut({ redirectUrl: window.location.pathname });
    };

    let body;
    if (!isLoaded) {
        body = <p className="cc__hint" role="status">Checking sign-in…</p>;
    } else if (!isSignedIn) {
        body = (
            <button type="button" className="cc__btn cc__btn--quiet" onClick={signIn}>
                Sign in to edit
            </button>
        );
    } else if (status === undefined) {
        body = <p className="cc__hint" role="status">Checking access…</p>;
    } else if (!status.allowed) {
        body = (
            <>
                <p className="cc__hint">This account can't edit.</p>
                <button type="button" className="cc__btn cc__btn--quiet" onClick={signOut}>
                    Sign out
                </button>
            </>
        );
    } else {
        body = (
            <>
                <div className="cc__bar-row">
                    <button type="button" className="cc__btn" onClick={onEdit}>
                        {hasCard ? "Edit" : "Create this card"}
                    </button>
                    <button
                        type="button"
                        className="cc__btn"
                        aria-expanded={creating}
                        onClick={() => setCreating((open) => !open)}
                    >
                        New card
                    </button>
                </div>
                {creating && <NewCardForm />}
                <button type="button" className="cc__link-btn" onClick={signOut}>
                    Sign out
                </button>
            </>
        );
    }
    return (
        <section className="cc__bar" aria-label="Edit this card">
            {body}
        </section>
    );
}

/* Asks for a slug, then opens the editor at /contact/<slug>. */
function NewCardForm() {
    const navigate = useNavigate();
    const [value, setValue] = useState("");
    const [error, setError] = useState("");

    const submit = (event) => {
        event.preventDefault();
        const next = value.trim().toLowerCase();
        if (!isValidSlug(next)) {
            setError("Use 1–32 lowercase letters, digits or dashes.");
            return;
        }
        navigate(`/contact/${next}`, { state: { openEditor: true } });
    };

    return (
        <form className="cc__new" onSubmit={submit} noValidate>
            <label className="cc__label" htmlFor="cc-new-slug">
                Address for the new card
            </label>
            <div className="cc__new-row">
                <span className="cc__prefix" aria-hidden="true">/contact/</span>
                <input
                    id="cc-new-slug"
                    className="cc__input"
                    value={value}
                    onChange={(e) => {
                        setValue(e.target.value);
                        setError("");
                    }}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={32}
                    placeholder="dad"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "cc-new-slug-error" : undefined}
                />
                <button type="submit" className="cc__btn">Go</button>
            </div>
            {error && (
                <p id="cc-new-slug-error" className="cc__error">{error}</p>
            )}
        </form>
    );
}

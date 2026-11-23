import React, { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { MAX_LINKS, NAME_MAX, LINK_HREF_MAX, LINK_LABEL_MAX, TEXT_FIELDS, normalizeCard } from "../lib/contactCard";
import { contactApi } from "./contactApi";

/*
 * The inline editor for one card. Checks the card with the same rules the
 * server uses (src/lib/contactCard.js) before saving, and shows the server's
 * per-field errors the same way if it still refuses. Warns before leaving
 * with unsaved changes.
 *
 * `initial` is the card being edited (saved or built in) or null for a new
 * one; `stored` says whether Convex holds a row for it, which is what Delete
 * removes. For "jr" that only drops the saved copy: /contact then shows the
 * built-in card again.
 */

const FIELDS = [
    { key: "name", label: "Name", max: NAME_MAX, autoComplete: "name" },
    { key: "title", label: "Title", autoComplete: "organization-title" },
    { key: "company", label: "Company", autoComplete: "organization" },
    { key: "location", label: "Location" },
    { key: "email", label: "Email", type: "email", inputMode: "email", autoComplete: "email" },
    { key: "phone", label: "Phone", type: "tel", inputMode: "tel", autoComplete: "tel", hint: "Digits, spaces, +, -, ( )" },
    { key: "note", label: "Note", multiline: true, hint: "One short line under the name" },
];
const NAME_PARTS = [
    { key: "given", label: "Given name" },
    { key: "family", label: "Family name" },
    { key: "suffix", label: "Suffix", hint: "e.g. Sr." },
];

function toForm(card) {
    const form = { name: (card && card.name) || "" };
    Object.keys(TEXT_FIELDS).forEach((key) => {
        form[key] = (card && card[key]) || "";
    });
    form.links = ((card && card.links) || []).map((link) => ({ label: link.label || "", href: link.href || "" }));
    return form;
}

export default function CardEditor({ slug, initial, stored, onDone }) {
    const upsert = useMutation(contactApi.upsert);
    const remove = useMutation(contactApi.remove);
    const start = useMemo(() => toForm(initial), [initial]);
    const [form, setForm] = useState(start);
    const [errors, setErrors] = useState({});
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const dirty = JSON.stringify(form) !== JSON.stringify(start);
    const isJr = slug === "jr";

    useEffect(() => {
        if (!dirty) return undefined;
        const warn = (event) => {
            event.preventDefault();
            event.returnValue = "";
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
    const setLink = (i, key, value) =>
        setForm((f) => ({ ...f, links: f.links.map((l, j) => (j === i ? { ...l, [key]: value } : l)) }));
    const addLink = () => setForm((f) => ({ ...f, links: [...f.links, { label: "", href: "https://" }] }));
    const removeLink = (i) => setForm((f) => ({ ...f, links: f.links.filter((_, j) => j !== i) }));

    const save = async (event) => {
        event.preventDefault();
        const checked = normalizeCard({ ...form, slug });
        if (Object.keys(checked.errors).length) {
            setErrors(checked.errors);
            setMessage("Check the highlighted fields.");
            return;
        }
        setBusy(true);
        setMessage("");
        try {
            await upsert({ card: checked.card });
            onDone();
        } catch (err) {
            const data = err && err.data;
            setErrors((data && data.errors) || {});
            setMessage((data && data.message) || "Couldn't save. Try again.");
            setBusy(false);
        }
    };

    const cancel = () => {
        if (dirty && !window.confirm("Discard your changes?")) return;
        onDone();
    };

    const destroy = async () => {
        const question = isJr
            ? "Delete the saved card? /contact goes back to the built-in card."
            : `Delete this card? /contact/${slug} will stop working.`;
        if (!window.confirm(question)) return;
        setBusy(true);
        try {
            await remove({ slug });
            onDone();
        } catch (err) {
            setMessage((err && err.data && err.data.message) || "Couldn't delete. Try again.");
            setBusy(false);
        }
    };

    const field = ({ key, label, type = "text", inputMode, autoComplete, multiline, hint, max }) => {
        const id = `cc-f-${key}`;
        const error = errors[key];
        const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
        const props = {
            id,
            className: "cc__input",
            value: form[key],
            onChange: (e) => set(key, e.target.value),
            maxLength: max || TEXT_FIELDS[key],
            autoComplete: autoComplete || "off",
            "aria-invalid": Boolean(error),
            "aria-describedby": describedBy,
        };
        return (
            <div className="cc__field" key={key}>
                <label className="cc__label" htmlFor={id}>
                    {label}
                    {key === "name" && <span aria-hidden="true"> *</span>}
                </label>
                {multiline ? (
                    <textarea {...props} rows={2} />
                ) : (
                    <input {...props} type={type} inputMode={inputMode} required={key === "name"} />
                )}
                {hint && <p id={`${id}-hint`} className="cc__hint">{hint}</p>}
                {error && <p id={`${id}-error`} className="cc__error">{error}</p>}
            </div>
        );
    };

    return (
        <form className="cc__card cc__editor" onSubmit={save} noValidate aria-labelledby="cc-editor-title">
            <h1 id="cc-editor-title" className="cc__editor-title">
                {initial ? "Edit card" : "New card"}
            </h1>
            <p className="cc__meta">/contact{isJr ? "" : `/${slug}`}</p>

            {FIELDS.map(field)}

            <fieldset className="cc__group">
                <legend className="cc__label">Name for saved contacts (optional)</legend>
                <p className="cc__hint">Only needed when the name doesn't split as "first … last".</p>
                {NAME_PARTS.map(field)}
            </fieldset>

            <fieldset className="cc__group">
                <legend className="cc__label">Links</legend>
                {errors.links && <p className="cc__error">{errors.links}</p>}
                {form.links.map((link, i) => {
                    const labelId = `cc-l-${i}-label`;
                    const hrefId = `cc-l-${i}-href`;
                    const labelError = errors[`links.${i}.label`];
                    const hrefError = errors[`links.${i}.href`];
                    return (
                        <div className="cc__link-row" key={i}>
                            <div className="cc__field">
                                <label className="cc__label" htmlFor={labelId}>Link {i + 1} label</label>
                                <input
                                    id={labelId}
                                    className="cc__input"
                                    value={link.label}
                                    maxLength={LINK_LABEL_MAX}
                                    onChange={(e) => setLink(i, "label", e.target.value)}
                                    aria-invalid={Boolean(labelError)}
                                    aria-describedby={labelError ? `${labelId}-error` : undefined}
                                />
                                {labelError && <p id={`${labelId}-error`} className="cc__error">{labelError}</p>}
                            </div>
                            <div className="cc__field">
                                <label className="cc__label" htmlFor={hrefId}>Link {i + 1} address</label>
                                <input
                                    id={hrefId}
                                    className="cc__input"
                                    type="url"
                                    inputMode="url"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    value={link.href}
                                    maxLength={LINK_HREF_MAX}
                                    onChange={(e) => setLink(i, "href", e.target.value)}
                                    aria-invalid={Boolean(hrefError)}
                                    aria-describedby={hrefError ? `${hrefId}-error` : undefined}
                                />
                                {hrefError && <p id={`${hrefId}-error`} className="cc__error">{hrefError}</p>}
                            </div>
                            <button type="button" className="cc__link-btn" onClick={() => removeLink(i)}>
                                Remove link {i + 1}
                            </button>
                        </div>
                    );
                })}
                <button
                    type="button"
                    className="cc__btn"
                    onClick={addLink}
                    disabled={form.links.length >= MAX_LINKS}
                >
                    Add link
                </button>
            </fieldset>

            <p className="cc__form-message" role="alert">{message}</p>

            <div className="cc__actions">
                <button type="submit" className="cc__btn cc__btn--primary" disabled={busy}>
                    {busy ? "Saving…" : "Save"}
                </button>
                <button type="button" className="cc__btn" onClick={cancel} disabled={busy}>
                    Cancel
                </button>
                {stored && (
                    <button type="button" className="cc__btn cc__btn--danger" onClick={destroy} disabled={busy}>
                        {isJr ? "Reset" : "Delete"}
                    </button>
                )}
            </div>
        </form>
    );
}

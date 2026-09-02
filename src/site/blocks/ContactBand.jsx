import React, { useEffect, useState } from "react";
import Reveal from "../Reveal";
import { person } from "../../data/site";
import { Copy, Check, GitHub, LinkedIn } from "../Icons";

export default function ContactBand() {
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return undefined;
        const timer = setTimeout(() => setCopied(false), 2000);
        return () => clearTimeout(timer);
    }, [copied]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(person.email);
            setCopied(true);
        } catch {
            window.location.href = `mailto:${person.email}`;
        }
    };

    return (
        <section className="section contact" id="contact" aria-labelledby="contact-title">
            <div className="container contact__inner">
                <Reveal>
                    <p className="eyebrow eyebrow--plain">Get in touch</p>
                    <h2 id="contact-title" className="display display--xl">
                        Say <em>hello.</em>
                    </h2>
                    <p className="lede" style={{ marginInline: "auto" }}>
                        Good for interesting problems, operations questions, small builds, or
                        telling me something on this site is broken.
                    </p>
                </Reveal>
                <Reveal index={1} className="contact__row">
                    <a className="contact__email" href={`mailto:${person.email}`}>
                        {person.email}
                    </a>
                    <button
                        type="button"
                        className={`copy-btn ${copied ? "is-done" : ""}`}
                        onClick={copy}
                        aria-live="polite"
                    >
                        {copied ? <Check /> : <Copy />}
                        {copied ? "Copied" : "Copy"}
                    </button>
                </Reveal>
                <Reveal index={2}>
                    <ul className="contact__links">
                        <li>
                            <a className="link" href={person.github} target="_blank" rel="noreferrer">
                                <GitHub /> GitHub
                            </a>
                        </li>
                        <li>
                            <a className="link" href={person.linkedin} target="_blank" rel="noreferrer">
                                <LinkedIn /> LinkedIn
                            </a>
                        </li>
                    </ul>
                </Reveal>
            </div>
        </section>
    );
}

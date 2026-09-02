import React from "react";
import Reveal from "../Reveal";
import ContactBand from "../blocks/ContactBand";
import { usePageMeta } from "../hooks";
import { Mark, GitHub, LinkedIn, Mail } from "../Icons";
import { about, colophon, person } from "../../data/site";

export default function About() {
    usePageMeta({
        title: "About",
        description:
            "JR Bussard is the COO of Cornerstone Companies in West Palm Beach, Florida, and builds small software on the side.",
    });

    return (
        <>
            <header className="container page-head">
                <p className="eyebrow">About</p>
                <h1 className="display display--xl">
                    Hi, I'm <em>JR.</em>
                </h1>
            </header>

            <section className="section section--tight" aria-label="Biography">
                <div className="container about">
                    <Reveal className="about__side">
                        <div className="monogram" aria-hidden="true">
                            <Mark size={200} />
                        </div>
                        <dl className="facts">
                            {about.facts.map((fact) => (
                                <div key={fact.label}>
                                    <dt>{fact.label}</dt>
                                    <dd>{fact.value}</dd>
                                </div>
                            ))}
                        </dl>
                        <ul className="contact__links" style={{ justifyContent: "flex-start" }}>
                            <li>
                                <a className="link" href={`mailto:${person.email}`}>
                                    <Mail /> Email
                                </a>
                            </li>
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

                    <Reveal className="about__body" index={1}>
                        <div className="prose">
                            {about.bio.map((paragraph) => (
                                <p key={paragraph}>{paragraph}</p>
                            ))}
                        </div>
                    </Reveal>
                </div>
            </section>

            <section className="section" aria-labelledby="colophon-title">
                <div className="container">
                    <Reveal className="section__head">
                        <div>
                            <p className="eyebrow">Colophon</p>
                            <h2 id="colophon-title" className="display display--m">
                                How this site is put together.
                            </h2>
                        </div>
                    </Reveal>
                    <Reveal as="dl" className="colophon" index={1}>
                        {colophon.map((item) => (
                            <div key={item.label}>
                                <dt>{item.label}</dt>
                                <dd>{item.value}</dd>
                            </div>
                        ))}
                    </Reveal>
                </div>
            </section>

            <ContactBand />
        </>
    );
}

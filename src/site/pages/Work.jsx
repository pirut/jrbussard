import React from "react";
import Reveal from "../Reveal";
import ContactBand from "../blocks/ContactBand";
import { usePageMeta, useSpotlight } from "../hooks";
import { ArrowUpRight } from "../Icons";
import { projects, principles } from "../../data/site";

function Status({ status }) {
    const kind = status === "running" ? "running" : "progress";
    return <span className={`pill pill--${kind}`}>{status}</span>;
}

function ProjectRow({ project, index }) {
    const link = project.links[0];
    return (
        <Reveal as="article" className="project-row" index={0} aria-labelledby={`project-${project.id}`}>
            <div className="project-row__meta">
                <p className="eyebrow">
                    {String(index + 1).padStart(2, "0")} · {project.role}
                </p>
                <h2 id={`project-${project.id}`} className="display display--m">
                    {project.name}
                </h2>
                <p className="project__tagline">{project.tagline}</p>
                <dl>
                    <dt>Status</dt>
                    <dd>
                        <Status status={project.status} />
                    </dd>
                    <dt>Since</dt>
                    <dd>{project.since}</dd>
                    <dt>Stack</dt>
                    <dd>{project.tags.join(", ")}</dd>
                </dl>
            </div>
            <div className="project-row__body">
                <p>{project.description}</p>
                <ul className="project__highlights">
                    {project.highlights.map((line) => (
                        <li key={line}>{line}</li>
                    ))}
                </ul>
                <div className="row">
                    {project.links.map((item) => (
                        <a
                            key={item.href}
                            className="btn btn--ghost"
                            href={item.href}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {item.label} <ArrowUpRight />
                        </a>
                    ))}
                </div>
            </div>
        </Reveal>
    );
}

function Principle({ item, index }) {
    const spotlight = useSpotlight();
    return (
        <Reveal className="card spot principle" index={index} onPointerMove={spotlight}>
            <span className="principle__num">No. {index + 1}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
        </Reveal>
    );
}

export default function Work() {
    usePageMeta({
        title: "Work",
        description:
            "What JR Bussard runs and what he has built: operations at Cornerstone Companies, plus Meltdown and Make Waves.",
    });

    return (
        <>
            <header className="container page-head">
                <p className="eyebrow">Work</p>
                <h1 className="display display--xl">
                    A company to run, <br />
                    and things to <em>build.</em>
                </h1>
                <p className="lede">
                    One of these is a day job with crews and permits and warranty calls. The rest
                    are side projects that stayed alive because real people use them.
                </p>
            </header>

            <section className="section section--tight" aria-label="Projects">
                <div className="container">
                    {projects.map((project, i) => (
                        <ProjectRow key={project.id} project={project} index={i} />
                    ))}
                </div>
            </section>

            <section className="section" aria-labelledby="principles-title">
                <div className="container">
                    <Reveal className="section__head">
                        <div>
                            <p className="eyebrow">How I work</p>
                            <h2 id="principles-title" className="display display--l">
                                Three things the work keeps teaching.
                            </h2>
                        </div>
                    </Reveal>
                    <div className="principles">
                        {principles.map((item, i) => (
                            <Principle key={item.title} item={item} index={i} />
                        ))}
                    </div>
                </div>
            </section>

            <ContactBand />
        </>
    );
}

import React from "react";
import Reveal from "../Reveal";
import { useSpotlight } from "../hooks";
import { ArrowUpRight } from "../Icons";

function Status({ status }) {
    const kind = status === "running" ? "running" : "progress";
    return <span className={`pill pill--${kind}`}>{status}</span>;
}

export default function ProjectCard({ project, feature = false, index = 0 }) {
    const spotlight = useSpotlight();
    const link = project.links[0];

    return (
        <Reveal
            as="a"
            href={link.href}
            target="_blank"
            rel="noreferrer"
            index={index}
            className={`card spot project ${feature ? "project--feature" : ""}`}
            onPointerMove={spotlight}
        >
            <div className="project__body">
                <div className="project__top">
                    <span>
                        {project.role} · since {project.since}
                    </span>
                    <Status status={project.status} />
                </div>
                <h3 className="project__name">{project.name}</h3>
                <p className="project__tagline">{project.tagline}</p>
                {!feature && <p className="project__desc">{project.description}</p>}
                {!feature && (
                    <div className="project__foot">
                        <ul className="tags">
                            {project.tags.map((tag) => (
                                <li className="tag" key={tag}>
                                    {tag}
                                </li>
                            ))}
                        </ul>
                        <span className="link">
                            {link.label} <ArrowUpRight />
                        </span>
                    </div>
                )}
            </div>

            {feature && (
                <div className="project__body">
                    <p className="project__desc">{project.description}</p>
                    <ul className="project__highlights">
                        {project.highlights.map((line) => (
                            <li key={line}>{line}</li>
                        ))}
                    </ul>
                    <div className="project__foot">
                        <ul className="tags">
                            {project.tags.map((tag) => (
                                <li className="tag" key={tag}>
                                    {tag}
                                </li>
                            ))}
                        </ul>
                        <span className="link">
                            {link.label} <ArrowUpRight />
                        </span>
                    </div>
                </div>
            )}
        </Reveal>
    );
}

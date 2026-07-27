import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { projects, arcade, about, contact } from "../data/site";

function formatDate(value) {
    if (!value) return "undated";
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return "undated";
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(date);
}

function timeAgo(value) {
    const seconds = Math.floor((Date.now() - new Date(value)) / 1000);
    if (!Number.isFinite(seconds)) return "a while ago";
    if (seconds < 3600) return `${Math.max(Math.floor(seconds / 60), 1)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
    return `${Math.floor(seconds / 2592000)}mo ago`;
}

function Tags({ items }) {
    if (!items || !items.length) return null;
    return (
        <ul className="panel__tags">
            {items.map((tag) => (
                <li key={tag}>{tag}</li>
            ))}
        </ul>
    );
}

function Lines({ items }) {
    return (
        <pre className="panel__lines">{items.join("\n")}</pre>
    );
}

function noteContent(note, notes, index) {
    return {
        type: "note",
        note,
        location: "THE LIBRARY",
        title: note.title,
        notes,
        index,
    };
}

/* Shared row shape for the terminal read-outs. */
function Rows({ items, empty }) {
    if (!items.length) return <p className="panel__prose">{empty}</p>;
    return <ul className="panel__index">{items}</ul>;
}

function Body({ content, onSelect }) {
    if (content.type === "commits") {
        const entries = content.entries || [];
        return (
            <>
                <p className="panel__meta">{content.kicker} · newest first</p>
                <h2 className="panel__title">{content.title}</h2>
                <Rows
                    empty="No signal from GitHub right now. Try the stars instead."
                    items={entries.map((commit) => (
                        <li key={commit.sha}>
                            <a href={commit.url} target="_blank" rel="noreferrer">
                                &gt; {commit.repo}
                            </a>
                            <span>
                                {commit.message} · {timeAgo(commit.date)}
                            </span>
                        </li>
                    ))}
                />
            </>
        );
    }

    if (content.type === "catalog") {
        const notes = content.notes || [];
        return (
            <>
                <p className="panel__meta">
                    {content.kicker} · {notes.length}{" "}
                    {notes.length === 1 ? "entry" : "entries"}
                </p>
                <h2 className="panel__title">{content.title}</h2>
                <Rows
                    empty="The shelves are empty. Nothing has been published yet."
                    items={notes.map((note, i) => (
                        <li key={note.slug}>
                            <button
                                type="button"
                                onClick={() => onSelect(noteContent(note, notes, i))}
                            >
                                &gt; {note.title}
                            </button>
                            <span>
                                {note.category} · {formatDate(note.date)}
                            </span>
                        </li>
                    ))}
                />
            </>
        );
    }

    if (content.type === "cabinets") {
        return (
            <>
                <p className="panel__meta">{content.kicker} · arcade floor</p>
                <h2 className="panel__title">{content.title}</h2>
                <ul className="panel__index">
                    {content.slots.map((app, i) => (
                        <li key={app ? app.id : `open-${i}`}>
                            {app ? (
                                <Link to={app.route}>
                                    &gt; slot {i + 1} — {app.name}
                                </Link>
                            ) : (
                                <span className="panel__dim">
                                    &gt; slot {i + 1} — unplugged
                                </span>
                            )}
                            <span>{app ? app.blurb : "Waiting on the next idea."}</span>
                        </li>
                    ))}
                </ul>
            </>
        );
    }

    if (content.type === "digest") {
        const latestNote = (content.notes || [])[0];
        const latestCommit = (content.activity || [])[0];
        const repos = content.repos || [];
        return (
            <>
                <p className="panel__meta">{content.kicker} · the atrium</p>
                <h2 className="panel__title">{content.title}</h2>

                <h3 className="panel__section">▤ latest note</h3>
                {latestNote ? (
                    <ul className="panel__index">
                        <li>
                            <button
                                type="button"
                                onClick={() => onSelect(noteContent(latestNote, content.notes, 0))}
                            >
                                &gt; {latestNote.title}
                            </button>
                            <span>{formatDate(latestNote.date)}</span>
                        </li>
                    </ul>
                ) : (
                    <p className="panel__prose">Nothing published yet.</p>
                )}

                <h3 className="panel__section">★ latest push</h3>
                {latestCommit ? (
                    <ul className="panel__index">
                        <li>
                            <a href={latestCommit.url} target="_blank" rel="noreferrer">
                                &gt; {latestCommit.repo}
                            </a>
                            <span>
                                {latestCommit.message} · {timeAgo(latestCommit.date)}
                            </span>
                        </li>
                    </ul>
                ) : (
                    <p className="panel__prose">Waiting on GitHub.</p>
                )}

                <h3 className="panel__section">◈ standing count</h3>
                <ul className="panel__index">
                    <li>
                        <span className="panel__dim">&gt; {content.notes.length} notes</span>
                        <span>west, in the library</span>
                    </li>
                    <li>
                        <span className="panel__dim">&gt; {projects.length} projects</span>
                        <span>east, in the foundry</span>
                    </li>
                    <li>
                        <span className="panel__dim">&gt; {repos.length} repositories</span>
                        <span>north, in the observatory</span>
                    </li>
                    <li>
                        <span className="panel__dim">&gt; {arcade.length} playable</span>
                        <span>south, in the arcade</span>
                    </li>
                </ul>
            </>
        );
    }

    if (content.type === "index") {
        return (
            <>
                <p className="panel__meta">for anyone who would rather not walk</p>
                <h2 className="panel__title">{content.title}</h2>

                <h3 className="panel__section">▤ notes — the library</h3>
                <ul className="panel__index">
                    {content.notes.length === 0 && <li>Loading the shelves…</li>}
                    {content.notes.map((note, i) => (
                        <li key={note.slug}>
                            <button
                                type="button"
                                onClick={() => onSelect(noteContent(note, content.notes, i))}
                            >
                                &gt; {note.title}
                            </button>
                            <span>{note.summary}</span>
                        </li>
                    ))}
                </ul>

                <h3 className="panel__section">◈ projects — the foundry</h3>
                <ul className="panel__index">
                    {projects.map((project) => (
                        <li key={project.id}>
                            <a href={project.href} target="_blank" rel="noreferrer">
                                &gt; {project.name}
                            </a>
                            <span>{project.tagline}</span>
                        </li>
                    ))}
                </ul>

                <h3 className="panel__section">▣ playable — the arcade</h3>
                <ul className="panel__index">
                    {arcade.map((app) => (
                        <li key={app.id}>
                            <Link to={app.route}>&gt; {app.name}</Link>
                            <span>{app.blurb}</span>
                        </li>
                    ))}
                </ul>

                <h3 className="panel__section">★ code — the observatory</h3>
                <ul className="panel__index">
                    {content.repos.length === 0 && <li>Waiting on GitHub…</li>}
                    {content.repos.slice(0, 6).map((repo) => (
                        <li key={repo.id}>
                            <a href={repo.html_url} target="_blank" rel="noreferrer">
                                &gt; {repo.name}
                            </a>
                            <span>{repo.description || "No description."}</span>
                        </li>
                    ))}
                </ul>

                <h3 className="panel__section">◉ contact — the beacon</h3>
                <ul className="panel__index">
                    <li>
                        <a href={`mailto:${contact.email}`}>&gt; {contact.email}</a>
                    </li>
                    {about.links.map((link) => (
                        <li key={link.href}>
                            <a href={link.href} target="_blank" rel="noreferrer">
                                &gt; {link.label}
                            </a>
                        </li>
                    ))}
                </ul>
            </>
        );
    }

    if (content.type === "note") {
        const { note, notes, index } = content;
        const previous = notes && index > 0 ? notes[index - 1] : null;
        const next = notes && index < notes.length - 1 ? notes[index + 1] : null;

        return (
            <>
                <p className="panel__meta">
                    {note.category} · {formatDate(note.date)}
                    {notes ? ` · ${index + 1} of ${notes.length}` : ""}
                </p>
                <h2 className="panel__title">{note.title}</h2>
                {note.summary && <p className="panel__lede">{note.summary}</p>}
                {note.body && (
                    <div className="panel__prose">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown>
                    </div>
                )}
                {(previous || next) && (
                    <nav className="panel__pager">
                        {previous ? (
                            <button
                                type="button"
                                onClick={() => onSelect(noteContent(previous, notes, index - 1))}
                            >
                                ◄ {previous.title}
                            </button>
                        ) : (
                            <span />
                        )}
                        {next && (
                            <button
                                type="button"
                                onClick={() => onSelect(noteContent(next, notes, index + 1))}
                            >
                                {next.title} ►
                            </button>
                        )}
                    </nav>
                )}
            </>
        );
    }

    if (content.type === "project") {
        const { project } = content;
        return (
            <>
                <p className="panel__meta">{project.role}</p>
                <h2 className="panel__title">{project.name}</h2>
                <p className="panel__lede">{project.tagline}</p>
                <p className="panel__prose">{project.description}</p>
                <Tags items={project.tags} />
                <a className="panel__action" href={project.href} target="_blank" rel="noreferrer">
                    &gt; open {project.href.replace(/^https?:\/\//, "")}
                </a>
            </>
        );
    }

    if (content.type === "repo") {
        const { repo } = content;
        return (
            <>
                <p className="panel__meta">
                    {repo.language || "repository"} · pushed {timeAgo(repo.pushed_at)}
                </p>
                <h2 className="panel__title">{repo.name}</h2>
                <p className="panel__prose">
                    {repo.description || "No description on this one."}
                </p>
                <Tags
                    items={[
                        `★ ${repo.stargazers_count || 0}`,
                        `${repo.forks_count || 0} forks`,
                        repo.private ? "private" : "public",
                    ]}
                />
                <a className="panel__action" href={repo.html_url} target="_blank" rel="noreferrer">
                    &gt; open on github
                </a>
            </>
        );
    }

    if (content.type === "arcade") {
        const { app } = content;
        return (
            <>
                <p className="panel__meta">arcade cabinet</p>
                <h2 className="panel__title">{app.name}</h2>
                <p className="panel__prose">{app.blurb}</p>
                <Tags items={app.tags} />
                <Link className="panel__action" to={app.route}>
                    &gt; insert coin
                </Link>
            </>
        );
    }

    if (content.type === "empty") {
        return (
            <>
                <p className="panel__meta">{content.kicker}</p>
                <h2 className="panel__title">{content.title}</h2>
                <p className="panel__prose">{content.message}</p>
            </>
        );
    }

    if (content.type === "contact") {
        const { info } = content;
        return (
            <>
                <p className="panel__meta">signal</p>
                <h2 className="panel__title">{info.title}</h2>
                <Lines items={info.lines} />
                <a className="panel__action" href={`mailto:${info.email}`}>
                    &gt; {info.email}
                </a>
            </>
        );
    }

    /* about + signposts */
    return (
        <>
            <p className="panel__meta">{content.kicker || "notice"}</p>
            <h2 className="panel__title">{content.title}</h2>
            <Lines items={content.lines} />
            {content.links && (
                <p className="panel__links">
                    {content.links.map((link) => (
                        <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                            &gt; {link.label}
                        </a>
                    ))}
                </p>
            )}
        </>
    );
}

export default function Panel({ content, onClose, onSelect }) {
    const ref = useRef(null);

    useEffect(() => {
        ref.current?.focus();
    }, [content]);

    return (
        <div className="panel-layer" onPointerDown={onClose}>
            <div
                className="panel"
                role="dialog"
                aria-modal="true"
                aria-label={content.title || "detail"}
                tabIndex={-1}
                ref={ref}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <header className="panel__bar">
                    <span>{content.location}</span>
                    <button type="button" onClick={onClose}>
                        [esc] close
                    </button>
                </header>
                <div className="panel__scroll">
                    <Body content={content} onSelect={onSelect} />
                </div>
            </div>
        </div>
    );
}

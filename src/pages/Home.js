import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useGitHub } from "../hooks/useGitHub";
import { fetchNotes } from "../lib/sanity";
import "../styles/Home.css";

const work = [
    {
        title: "Cornerstone Companies",
        type: "COO",
        href: "https://cstonefl.com",
        description:
            "Full-time operations role at a South Florida impact window and door company.",
        tags: ["operations", "people", "systems"],
    },
    {
        title: "Meltdown",
        type: "Side project",
        href: "https://meltdown.jrbussard.com",
        description:
            "A small app for parents to post the funny reasons their kid had a meltdown.",
        tags: ["react", "supabase", "social"],
    },
    {
        title: "Make Waves",
        type: "Side project",
        href: "https://waves.jrbussard.com",
        description:
            "A lightweight tool for organizing community work, people, and follow-up.",
        tags: ["next", "postgres", "events"],
    },
];

const links = [
    { label: "GitHub", href: "https://github.com/pirut" },
    { label: "LinkedIn", href: "https://linkedin.com/in/jr-bussard" },
    { label: "Email", href: "mailto:scottbussardjr@gmail.com" },
];

const langColors = {
    JavaScript: "#eab308",
    TypeScript: "#38bdf8",
    HTML: "#fb7185",
    CSS: "#a78bfa",
    Python: "#60a5fa",
    Shell: "#4ade80",
    Swift: "#fb923c",
    Go: "#2dd4bf",
    Ruby: "#f43f5e",
};

function timeAgo(dateStr) {
    const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (seconds < 60) return `${Math.max(seconds, 0)}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    return `${Math.floor(days / 30)}mo`;
}

function formatTime(date) {
    return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
    }).format(date);
}

function formatNoteDate(dateStr) {
    if (!dateStr) return "Draft";
    const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
        ? `${dateStr}T12:00:00`
        : dateStr;

    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(new Date(dateValue));
}

const Home = () => {
    const { repos, activity, loading, error } = useGitHub();
    const [clock, setClock] = useState(new Date());
    const [activeWork, setActiveWork] = useState(work[0].title);
    const [blogNotes, setBlogNotes] = useState([]);
    const [notesLoading, setNotesLoading] = useState(true);

    useEffect(() => {
        const id = setInterval(() => setClock(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        let mounted = true;

        fetchNotes()
            .then((loadedNotes) => {
                if (mounted) setBlogNotes(loadedNotes);
            })
            .finally(() => {
                if (mounted) setNotesLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, []);

    const displayRepos = repos.slice(0, 5);
    const activeItem = useMemo(
        () => work.find((item) => item.title === activeWork) || work[0],
        [activeWork]
    );
    const totalStars = repos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);

    return (
        <main className="home">
            <header className="topbar">
                <a href="#top" className="topbar__brand">JR Bussard</a>
                <nav className="topbar__nav" aria-label="Primary">
                    <a href="#work">Work</a>
                    <a href="#code">Code</a>
                    <a href="#notes">Notes</a>
                    <a href="#contact">Contact</a>
                </nav>
                <span className="topbar__time">{formatTime(clock)}</span>
            </header>

            <section className="hero" id="top" aria-labelledby="hero-title">
                <div className="hero__intro">
                    <p className="label">COO / builder / West Palm Beach</p>
                    <h1 id="hero-title">I run operations and build small web projects.</h1>
                    <p>
                        This is my personal homepage. It has what I do for work, a few side
                        projects, public code, and recent GitHub activity.
                    </p>
                    <div className="hero__actions">
                        <a href="#work">View work</a>
                        <a href="mailto:scottbussardjr@gmail.com">Email me</a>
                    </div>
                </div>

                <aside className="status-panel" aria-label="Site status">
                    <div className="status-panel__head">
                        <span>Live</span>
                        <i />
                    </div>
                    <dl>
                        <div>
                            <dt>Repos</dt>
                            <dd>{repos.length || "--"}</dd>
                        </div>
                        <div>
                            <dt>Stars</dt>
                            <dd>{totalStars || "--"}</dd>
                        </div>
                        <div>
                            <dt>Commits</dt>
                            <dd>{loading ? "--" : activity.length}</dd>
                        </div>
                    </dl>
                </aside>

                <section className="activity-strip" aria-label="Recent activity">
                    {loading && <span>Loading GitHub activity...</span>}
                    {error && <span>GitHub activity unavailable.</span>}
                    {!loading && !error && activity.slice(0, 4).map((commit) => (
                        <a href={commit.url} target="_blank" rel="noreferrer" key={commit.sha}>
                            <span>{timeAgo(commit.date)}</span>
                            <strong>{commit.repo}</strong>
                            <em>{commit.message}</em>
                        </a>
                    ))}
                </section>
            </section>

            <section className="grid-section" id="work" aria-labelledby="work-title">
                <div className="section-title">
                    <span>01</span>
                    <h2 id="work-title">Work</h2>
                </div>

                <div className="work-layout">
                    <div className="work-list" role="list">
                        {work.map((item) => (
                            <a
                                href={item.href}
                                target="_blank"
                                rel="noreferrer"
                                className={`work-row ${activeWork === item.title ? "is-active" : ""}`}
                                key={item.title}
                                onMouseEnter={() => setActiveWork(item.title)}
                                onFocus={() => setActiveWork(item.title)}
                            >
                                <span>{item.type}</span>
                                <strong>{item.title}</strong>
                                <small>{item.description}</small>
                            </a>
                        ))}
                    </div>

                    <aside className="work-preview">
                        <span>Selected</span>
                        <h3>{activeItem.title}</h3>
                        <p>{activeItem.description}</p>
                        <div>
                            {activeItem.tags.map((tag) => (
                                <span key={tag}>{tag}</span>
                            ))}
                        </div>
                    </aside>
                </div>
            </section>

            <section className="grid-section code-section" id="code" aria-labelledby="code-title">
                <div className="section-title">
                    <span>02</span>
                    <h2 id="code-title">Code</h2>
                </div>
                {loading && <p className="empty">Loading repositories...</p>}
                {!loading && (
                    <div className="repo-board">
                        {displayRepos.map((repo) => (
                            <a href={repo.html_url} target="_blank" rel="noreferrer" key={repo.id}>
                                <h3>{repo.name}</h3>
                                <p>{repo.description || "Public repo."}</p>
                                <div>
                                    {repo.language && (
                                        <span>
                                            <i style={{ background: langColors[repo.language] || "var(--muted)" }} />
                                            {repo.language}
                                        </span>
                                    )}
                                    <span>{timeAgo(repo.pushed_at)} ago</span>
                                </div>
                            </a>
                        ))}
                    </div>
                )}
            </section>

            <section className="notes-section" id="notes" aria-labelledby="notes-title">
                <div className="section-title">
                    <span>03</span>
                    <h2 id="notes-title">Notes</h2>
                </div>
                <div className="blog">
                    <div className="blog__intro">
                        <p>
                            Short posts on code, work, operations, and whatever else is
                            worth keeping around.
                        </p>
                    </div>
                    <ol className="blog__list">
                        {notesLoading && <li className="empty">Loading notes...</li>}
                        {!notesLoading && blogNotes.length === 0 && (
                            <li className="empty">No notes published yet.</li>
                        )}
                        {!notesLoading && blogNotes.map((note) => (
                            <li key={note.id || note.slug}>
                                <article className="blog-card">
                                    <div className="blog-card__meta">
                                        <span>{formatNoteDate(note.date)}</span>
                                        <span>{note.category}</span>
                                    </div>
                                    <h3>{note.title}</h3>
                                    <p>{note.summary}</p>
                                    {note.body && (
                                        <details>
                                            <summary>Read note</summary>
                                            <div className="blog-card__body">
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {note.body}
                                                </ReactMarkdown>
                                            </div>
                                        </details>
                                    )}
                                </article>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            <footer className="contact-section" id="contact">
                <div>
                    <span className="label">Contact</span>
                    <h2>That is it.</h2>
                    <p>No pitch. Just a simple page with the current stuff.</p>
                </div>
                <div className="contact-section__links">
                    {links.map((link) => (
                        <a href={link.href} target={link.href.startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer" key={link.label}>
                            {link.label}
                        </a>
                    ))}
                </div>
            </footer>
        </main>
    );
};

export default Home;

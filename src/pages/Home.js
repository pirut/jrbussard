import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useGitHub } from "../hooks/useGitHub";
import { fetchNotes } from "../lib/sanity";
import "../styles/Home.css";

const projects = [
    {
        id: "cornerstone",
        index: "01",
        title: ["Cornerstone", "Companies"],
        role: "COO",
        statement: <>Make the real world <em>run.</em></>,
        description:
            "Operating the people, systems, and day-to-day work behind a South Florida impact window and door company.",
        tags: ["Operations", "People", "Systems"],
        href: "https://cstonefl.com",
    },
    {
        id: "meltdown",
        index: "02",
        title: ["Meltdown"],
        role: "Side project",
        statement: <>Turn chaos into a <em>story.</em></>,
        description:
            "A small social app for the funny, inexplicable reasons kids have a meltdown.",
        tags: ["React", "Supabase", "Social"],
        href: "https://meltdown.jrbussard.com",
    },
    {
        id: "waves",
        index: "03",
        title: ["Make Waves"],
        role: "Side project",
        statement: <>Turn energy into <em>action.</em></>,
        description:
            "A lightweight platform for turning community energy into organized action.",
        tags: ["Next.js", "Postgres", "Events"],
        href: "https://waves.jrbussard.com",
    },
];

const socialLinks = [
    { label: "GitHub", href: "https://github.com/pirut" },
    { label: "LinkedIn", href: "https://www.linkedin.com/in/jr-bussard-0937bb122/" },
];

function timeAgo(dateStr) {
    const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (!Number.isFinite(seconds)) return "recently";
    if (seconds < 60) return `${Math.max(seconds, 0)}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    return `${Math.floor(days / 30)}mo`;
}

function formatNoteDate(dateStr) {
    if (!dateStr) return "Draft";
    const value = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
        ? `${dateStr}T12:00:00`
        : dateStr;

    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(new Date(value));
}

function Arrow({ direction = "right" }) {
    const rotation = direction === "down" ? 90 : direction === "up" ? -90 : direction === "left" ? 180 : 0;

    return (
        <svg
            className="machine-arrow"
            viewBox="0 0 48 24"
            aria-hidden="true"
            style={{ transform: `rotate(${rotation}deg)` }}
        >
            <path d="M1 12h43" />
            <path d="m34 2 10 10-10 10" />
        </svg>
    );
}

function RegistrationMark({ className = "" }) {
    return (
        <span className={`registration-mark ${className}`} aria-hidden="true">
            <i />
        </span>
    );
}

function BrandMark() {
    return (
        <span className="brand-mark" aria-label="JR Bussard">
            <strong>JR</strong>
            <i aria-hidden="true">/</i>
            <strong>Bussard</strong>
        </span>
    );
}

function MagneticLink({ className = "", children, ...props }) {
    const handleMove = (event) => {
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left - rect.width / 2) * 0.14;
        const y = (event.clientY - rect.top - rect.height / 2) * 0.14;
        event.currentTarget.style.setProperty("--magnet-x", `${x}px`);
        event.currentTarget.style.setProperty("--magnet-y", `${y}px`);
    };

    const handleLeave = (event) => {
        event.currentTarget.style.setProperty("--magnet-x", "0px");
        event.currentTarget.style.setProperty("--magnet-y", "0px");
    };

    return (
        <a
            className={`magnetic-link ${className}`}
            onPointerMove={handleMove}
            onPointerLeave={handleLeave}
            {...props}
        >
            {children}
        </a>
    );
}

function ProjectArt({ id }) {
    if (id === "cornerstone") {
        return (
            <div className="project-art project-art--window" aria-hidden="true">
                <span /><span /><span /><span />
                <i className="window-sun" />
            </div>
        );
    }

    if (id === "meltdown") {
        return (
            <div className="project-art project-art--melt" aria-hidden="true">
                <span className="melt-orbit melt-orbit--one" />
                <span className="melt-orbit melt-orbit--two" />
                <span className="melt-face">:)</span>
            </div>
        );
    }

    return (
        <div className="project-art project-art--waves" aria-hidden="true">
            <span /><span /><span /><span /><span />
            <i />
        </div>
    );
}

function ProjectScene({ project, nextProject }) {
    return (
        <section
            className={`project-scene project-scene--${project.id}`}
            id={`project-${project.id}`}
            aria-labelledby={`${project.id}-title`}
            data-scene
        >
            <svg className="project-power-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path pathLength="1" d="M1,10 H76 L84,20 V78 H97" />
            </svg>
            <RegistrationMark className="project-register project-register--one" />
            <RegistrationMark className="project-register project-register--two" />
            <span className="project-scene__index" aria-hidden="true">{project.index}</span>

            <div className="project-scene__frame">
                <header className="project-scene__header" data-enter>
                    <p>{project.role}</p>
                    <h2 id={`${project.id}-title`}>
                        {project.title.map((line) => <span key={line}>{line}</span>)}
                    </h2>
                </header>

                <div className="project-scene__story" data-enter>
                    <h3>{project.statement}</h3>
                    <p>{project.description}</p>
                    <div className="project-scene__tags">
                        {project.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                </div>

                <ProjectArt id={project.id} />

                <MagneticLink
                    className="project-scene__link"
                    href={project.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${project.title.join(" ")} project`}
                >
                    <span>Open<br />project</span>
                    <Arrow />
                </MagneticLink>
            </div>

            <a className="project-scene__next" href={nextProject ? `#project-${nextProject.id}` : "#code"}>
                <span>{nextProject ? nextProject.index : "04"}</span>
                <i aria-hidden="true" />
                <strong>{nextProject ? nextProject.title.join(" ") : "Built in public"}</strong>
                <Arrow />
            </a>
        </section>
    );
}

const Home = () => {
    const homeRef = useRef(null);
    const { repos, activity, loading, error } = useGitHub();
    const [menuOpen, setMenuOpen] = useState(false);
    const [blogNotes, setBlogNotes] = useState([]);
    const [notesLoading, setNotesLoading] = useState(true);
    const [activeRepo, setActiveRepo] = useState(null);
    const [activeNoteIndex, setActiveNoteIndex] = useState(0);
    const studioUrl = process.env.REACT_APP_SANITY_STUDIO_URL || "https://www.sanity.io/manage";

    useEffect(() => {
        document.title = "JR Bussard — Operator & Builder";
    }, []);

    useEffect(() => {
        let mounted = true;
        fetchNotes()
            .then((notes) => {
                if (mounted) setBlogNotes(notes);
            })
            .finally(() => {
                if (mounted) setNotesLoading(false);
            });

        return () => {
            mounted = false;
        };
    }, []);

    useEffect(() => {
        if (!menuOpen) return undefined;
        const previous = document.body.style.overflow;
        const onKeyDown = (event) => {
            if (event.key === "Escape") setMenuOpen(false);
        };

        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKeyDown);
        return () => {
            document.body.style.overflow = previous;
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [menuOpen]);

    useEffect(() => {
        if (!blogNotes.length) return undefined;

        let frame;
        let realignTimer;
        const syncNoteFromHash = () => {
            if (!window.location.hash.startsWith("#note-")) return;
            const requestedSlug = window.location.hash.slice("#note-".length);
            const requestedIndex = blogNotes.findIndex((note) => note.slug === requestedSlug);
            if (requestedIndex < 0) return;

            setActiveNoteIndex(requestedIndex);
            const alignNote = () => {
                const targetId = window.matchMedia("(max-width: 760px)").matches ? "active-note" : "notes";
                document.getElementById(targetId)?.scrollIntoView({ behavior: "instant", block: "start" });
            };

            window.cancelAnimationFrame(frame);
            window.clearTimeout(realignTimer);
            frame = window.requestAnimationFrame(alignNote);
            realignTimer = window.setTimeout(alignNote, 1200);
        };

        syncNoteFromHash();
        window.addEventListener("hashchange", syncNoteFromHash);

        return () => {
            window.cancelAnimationFrame(frame);
            window.clearTimeout(realignTimer);
            window.removeEventListener("hashchange", syncNoteFromHash);
        };
    }, [blogNotes, repos.length, activity.length]);

    useEffect(() => {
        const root = homeRef.current;
        if (!root) return undefined;

        let pointerFrame;
        let scrollFrame;
        const scenes = Array.from(root.querySelectorAll("[data-scene]"));
        const enterElements = Array.from(root.querySelectorAll("[data-enter]"));
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        const onPointerMove = (event) => {
            if (reduceMotion) return;
            window.cancelAnimationFrame(pointerFrame);
            pointerFrame = window.requestAnimationFrame(() => {
                root.style.setProperty("--pointer-x", `${event.clientX / window.innerWidth - 0.5}`);
                root.style.setProperty("--pointer-y", `${event.clientY / window.innerHeight - 0.5}`);
            });
        };

        const onScroll = () => {
            window.cancelAnimationFrame(scrollFrame);
            scrollFrame = window.requestAnimationFrame(() => {
                const max = document.documentElement.scrollHeight - window.innerHeight;
                root.style.setProperty("--page-progress", max > 0 ? `${window.scrollY / max}` : "0");
                scenes.forEach((scene) => {
                    const rect = scene.getBoundingClientRect();
                    const progress = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / (window.innerHeight + rect.height)));
                    scene.style.setProperty("--scene-progress", progress.toFixed(4));
                });
            });
        };

        enterElements.forEach((element) => element.classList.add("is-ready"));
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("is-inview");
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.16, rootMargin: "0px 0px -5%" });

        enterElements.forEach((element) => observer.observe(element));
        onScroll();
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        window.addEventListener("scroll", onScroll, { passive: true });

        return () => {
            observer.disconnect();
            window.cancelAnimationFrame(pointerFrame);
            window.cancelAnimationFrame(scrollFrame);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("scroll", onScroll);
        };
    }, [repos.length, activity.length, blogNotes.length]);

    const displayRepos = repos.slice(0, 5);
    const activeRepoId = activeRepo || displayRepos[0]?.id;
    const activeNote = useMemo(
        () => blogNotes[activeNoteIndex] || blogNotes[0],
        [activeNoteIndex, blogNotes]
    );
    const closeMenu = () => setMenuOpen(false);
    const selectNote = (index) => {
        setActiveNoteIndex(index);
        const note = blogNotes[index];
        if (note?.slug) window.history.replaceState(null, "", `#note-${note.slug}`);

        if (window.matchMedia("(max-width: 760px)").matches) {
            window.requestAnimationFrame(() => {
                document.getElementById("active-note")?.scrollIntoView({
                    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                    block: "start",
                });
            });
        }
    };
    const moveNote = (direction) => {
        if (!blogNotes.length) return;
        const nextIndex = (activeNoteIndex + direction + blogNotes.length) % blogNotes.length;
        selectNote(nextIndex);
    };
    const handleNoteKeyDown = (event, index) => {
        const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
        if (!keys.includes(event.key) || !blogNotes.length) return;

        event.preventDefault();
        let nextIndex = index;
        if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (index + 1) % blogNotes.length;
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (index - 1 + blogNotes.length) % blogNotes.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = blogNotes.length - 1;

        selectNote(nextIndex);
        window.requestAnimationFrame(() => {
            document.getElementById(`note-tab-${blogNotes[nextIndex].slug}`)?.focus();
        });
    };

    return (
        <main className="kinetic-site" id="top" ref={homeRef}>
            <a className="skip-link" href="#project-cornerstone">Skip to projects</a>
            <div className="machine-progress" aria-hidden="true"><i /></div>

            <section className="kinetic-hero" aria-labelledby="hero-title" data-scene>
                <header className="machine-header">
                    <a className="machine-header__brand" href="#top" onClick={closeMenu}><BrandMark /></a>
                    <button
                        className={`machine-menu ${menuOpen ? "is-open" : ""}`}
                        type="button"
                        aria-expanded={menuOpen}
                        aria-controls="machine-navigation"
                        onClick={() => setMenuOpen((open) => !open)}
                    >
                        <span>{menuOpen ? "Close" : "Menu"}</span>
                        <i aria-hidden="true" />
                    </button>
                    <nav className={`machine-nav ${menuOpen ? "is-open" : ""}`} id="machine-navigation" aria-label="Primary">
                        <a href="#project-cornerstone" onClick={closeMenu}>Projects</a>
                        <a href="#code" onClick={closeMenu}>Now</a>
                        <a href="#notes" onClick={closeMenu}>Notes</a>
                        <a href="#contact" onClick={closeMenu}>Hello</a>
                    </nav>
                </header>

                <div className="hero-shape hero-shape--left" aria-hidden="true" />
                <div className="hero-shape hero-shape--bottom" aria-hidden="true" />
                <span className="hero-gold-square" aria-hidden="true" />
                <RegistrationMark className="hero-register" />

                <h1 id="hero-title" className="kinetic-hero__headline">
                    <span>I make</span>
                    <span>complex</span>
                    <em>work.</em>
                </h1>

                <p className="kinetic-hero__intro">COO, operator, and software builder in West Palm Beach.</p>

                <figure className="kinetic-hero__portrait">
                    <span className="portrait-shadow" aria-hidden="true" />
                    <img src={`${process.env.PUBLIC_URL}/assets/jr-halftone.webp`} alt="JR Bussard smiling" loading="eager" />
                    <figcaption>JR Bussard</figcaption>
                </figure>

                <MagneticLink className="hero-enter" href="#project-cornerstone">
                    <span>Enter<br />the work</span>
                    <Arrow />
                </MagneticLink>

                <aside className="hero-rail" aria-label="Disciplines">
                    <span>Operations — Software — People</span>
                    <i aria-hidden="true" />
                </aside>

                <a className="hero-next" href="#project-cornerstone">
                    <span>01</span>
                    <i aria-hidden="true" />
                    <strong>Cornerstone Companies</strong>
                    <Arrow />
                </a>
            </section>

            {projects.map((project, index) => (
                <ProjectScene project={project} nextProject={projects[index + 1]} key={project.id} />
            ))}

            <section className="plotter-scene" id="code" aria-labelledby="code-title" data-scene>
                <RegistrationMark className="plotter-register" />
                <header className="plotter-intro" data-enter>
                    <p>Built in public</p>
                    <h2 id="code-title"><span>Built</span><span>in</span><span>public.</span></h2>
                    <p>Live repositories and recent moves, straight from GitHub.</p>
                    <a href="https://github.com/pirut" target="_blank" rel="noreferrer">View GitHub <Arrow /></a>
                </header>

                <div className="plotter-machine" data-enter>
                    <div className="plotter-machine__hardware" aria-hidden="true"><i /><i /><i /></div>
                    <div className="plotter-paper">
                        <span className="paper-holes paper-holes--left" aria-hidden="true" />
                        <span className="paper-holes paper-holes--right" aria-hidden="true" />
                        {loading && (
                            <ol className="repo-ribbon" aria-label="Loading repositories">
                                {[0, 1, 2, 3, 4].map((item) => <li className="repo-ribbon__loading" key={item}>Repository loading</li>)}
                            </ol>
                        )}
                        {!loading && error && (
                            <div className="plotter-error">
                                <strong>GitHub is taking a minute.</strong>
                                <a href="https://github.com/pirut" target="_blank" rel="noreferrer">Browse it directly <Arrow /></a>
                            </div>
                        )}
                        {!loading && !error && (
                            <ol className="repo-ribbon">
                                {displayRepos.map((repo) => {
                                    const selected = activeRepoId === repo.id;
                                    return (
                                        <li key={repo.id} className={selected ? "is-active" : ""}>
                                            <a
                                                href={repo.html_url}
                                                target="_blank"
                                                rel="noreferrer"
                                                onMouseEnter={() => setActiveRepo(repo.id)}
                                                onFocus={() => setActiveRepo(repo.id)}
                                            >
                                                <strong>{repo.name}</strong>
                                                <span>{repo.language || "Public"}</span>
                                                <span>{timeAgo(repo.pushed_at)} ago</span>
                                                <small>{repo.description || "Public repository."}</small>
                                            </a>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </div>

                    <div className="commit-plot" aria-label="Latest commits">
                        <header><span>Latest commits</span><i aria-hidden="true" /></header>
                        <ol>
                            {activity.slice(0, 4).map((commit, index) => (
                                <li key={commit.sha} style={{ "--node": index }}>
                                    <a href={commit.url} target="_blank" rel="noreferrer">
                                        <i aria-hidden="true" />
                                        <span>{timeAgo(commit.date)}</span>
                                        <strong>{commit.repo}</strong>
                                        <small>{commit.message}</small>
                                    </a>
                                </li>
                            ))}
                        </ol>
                    </div>
                </div>
            </section>

            <section className="notes-machine" id="notes" aria-labelledby="notes-title" data-scene>
                <RegistrationMark className="notes-register" />
                <div className="notes-machine__cover" data-enter>
                    <p>Notes from the work</p>
                    <h2 id="notes-title">Field <em>notes</em></h2>
                    <p>Operations, software, people, and the systems between them.</p>
                    <a className="notes-manage" href={studioUrl} target="_blank" rel="noreferrer">
                        Manage notes <Arrow />
                    </a>
                </div>

                <div className="note-stack" data-enter>
                    <div className="note-stack__tabs" role="tablist" aria-label="Field notes">
                        {notesLoading && <span>Loading notes…</span>}
                        {!notesLoading && blogNotes.length === 0 && <span>No notes published yet.</span>}
                        {blogNotes.map((note, index) => (
                            <button
                                type="button"
                                role="tab"
                                id={`note-tab-${note.slug}`}
                                aria-selected={index === activeNoteIndex}
                                aria-controls="active-note"
                                tabIndex={index === activeNoteIndex ? 0 : -1}
                                className={index === activeNoteIndex ? "is-active" : ""}
                                onClick={() => selectNote(index)}
                                onKeyDown={(event) => handleNoteKeyDown(event, index)}
                                key={note.id || note.slug}
                            >
                                <span>{String(index + 1).padStart(2, "0")}</span>
                                <strong>{note.title}</strong>
                                <small>{note.category}</small>
                                <time dateTime={note.date}>{formatNoteDate(note.date)}</time>
                                <Arrow />
                            </button>
                        ))}
                    </div>

                    {activeNote && (
                        <article
                            className="active-note"
                            id="active-note"
                            data-note-slug={activeNote.slug}
                            role="tabpanel"
                            aria-labelledby={`note-tab-${activeNote.slug}`}
                            key={activeNote.id || activeNote.slug}
                        >
                            <header>
                                <span>{activeNote.category}</span>
                                <time dateTime={activeNote.date}>{formatNoteDate(activeNote.date)}</time>
                            </header>
                            <h3>{activeNote.title}</h3>
                            <p>{activeNote.summary}</p>
                            {activeNote.body && (
                                <div className="active-note__body">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeNote.body}</ReactMarkdown>
                                </div>
                            )}
                            <nav className="active-note__controls" aria-label="Browse notes">
                                <button type="button" onClick={() => moveNote(-1)}><Arrow direction="left" /> Previous</button>
                                <span>{String(activeNoteIndex + 1).padStart(2, "0")} / {String(blogNotes.length).padStart(2, "0")}</span>
                                <button type="button" onClick={() => moveNote(1)}>Next <Arrow /></button>
                            </nav>
                        </article>
                    )}
                </div>
            </section>

            <section className="finale" id="contact" aria-labelledby="contact-title" data-scene>
                <RegistrationMark className="finale-register" />
                <svg className="finale-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <path pathLength="1" d="M48 10 H76 Q84 10 84 20 V48 L79 61" />
                    <circle cx="79" cy="61" r="1.6" />
                </svg>
                <h2 id="contact-title" data-enter>
                    <span>Make the</span>
                    <span>next thing</span>
                    <em>move.</em>
                </h2>
                <p className="finale__copy">Thoughtful work.<br />Useful software.<br />Good people.</p>
                <MagneticLink className="finale-email" href="mailto:scottbussardjr@gmail.com">
                    <span>scottbussardjr@gmail.com</span>
                    <RegistrationMark />
                </MagneticLink>

                <footer className="finale-footer">
                    <span className="finale-footer__signature">JR Bussard — West Palm Beach, FL</span>
                    <nav aria-label="Footer">
                        {socialLinks.map((link) => (
                            <a href={link.href} target="_blank" rel="noreferrer" key={link.label}>{link.label}<Arrow /></a>
                        ))}
                        <a href="#top">Back to top<Arrow direction="up" /></a>
                    </nav>
                </footer>
            </section>
        </main>
    );
};

export default Home;

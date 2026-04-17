import React, { useState, useEffect, useRef, useCallback } from "react";
import { useGitHub } from "../hooks/useGitHub";
import "../styles/Home.css";

const GITHUB_USER = "pirut";

const featuredProjects = [
    {
        index: "01",
        title: "Cornerstone Companies",
        kicker: "Day job",
        year: "2024 —",
        href: "https://cstonefl.com",
        domain: "cstonefl.com",
        stack: ["Next.js", "Sanity", "Motion"],
        description:
            "South Florida impact windows and doors. I got curious about the website and kept going.",
    },
    {
        index: "02",
        title: "Meltdown",
        kicker: "Side project",
        year: "2025",
        href: "https://meltdown.jrbussard.com",
        domain: "meltdown.jrbussard.com",
        stack: ["React", "Supabase", "Tailwind"],
        description:
            "Parents share why their kid had a meltdown today. Made it because the stories are too funny not to have a place for them.",
    },
    {
        index: "03",
        title: "Make Waves",
        kicker: "Side project",
        year: "2025",
        href: "https://waves.jrbussard.com",
        domain: "waves.jrbussard.com",
        stack: ["Next.js", "Postgres", "Edge"],
        description:
            "Built this for friends who organize community events. Helps them keep things moving between campaigns.",
    },
];

const obsessions = [
    { n: "01", text: "Seeing how far AI tools can take an idea." },
    { n: "02", text: "Browser games I'd actually want to play." },
    { n: "03", text: "Making useful things for people I know." },
    { n: "04", text: "Late-night builds, small weird domains." },
];

const signals = [
    { label: "West Palm Beach, FL", kind: "loc" },
    { label: "26.71°N / 80.05°W", kind: "coord" },
    { label: "Signal nominal", kind: "status" },
    { label: "Index 04", kind: "index" },
];

const langColors = {
    JavaScript: "#ffc268",
    TypeScript: "#8affd4",
    HTML: "#ff5a1f",
    CSS: "#c264ff",
    Python: "#6aa9ff",
    Java: "#d2935b",
    Go: "#37d0e4",
    Rust: "#ff9466",
    Ruby: "#ff4e6e",
    Shell: "#7fe27f",
    C: "#b0b0b0",
    "C++": "#ff6aa6",
    "C#": "#5cd06b",
    PHP: "#8ea0ff",
    Swift: "#ff7a4a",
    Kotlin: "#c89cff",
};

function timeAgo(dateStr) {
    const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return `${months}mo`;
}

function formatUTC(d) {
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    const s = String(d.getUTCSeconds()).padStart(2, "0");
    return `${h}:${m}:${s} UTC`;
}

const SCRAMBLE_CHARS = "█▓▒░01▲▼◢◣◤◥▌▐<>/*#@&!?$";

// Scrambles characters on hover, then locks to the real string.
function Scramble({ text, className = "", as: Tag = "span" }) {
    const [out, setOut] = useState(text);
    const rafRef = useRef(0);
    const startRef = useRef(0);
    const lockedRef = useRef(false);

    const run = useCallback(() => {
        if (lockedRef.current) return;
        lockedRef.current = true;
        cancelAnimationFrame(rafRef.current);
        startRef.current = performance.now();
        const duration = 420;
        const step = (t) => {
            const k = Math.min(1, (t - startRef.current) / duration);
            const lockIndex = Math.floor(k * text.length);
            let next = "";
            for (let i = 0; i < text.length; i++) {
                if (i < lockIndex || text[i] === " ") {
                    next += text[i];
                } else {
                    next +=
                        SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
                }
            }
            setOut(next);
            if (k < 1) {
                rafRef.current = requestAnimationFrame(step);
            } else {
                setOut(text);
                lockedRef.current = false;
            }
        };
        rafRef.current = requestAnimationFrame(step);
    }, [text]);

    useEffect(() => {
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    return (
        <Tag className={className} onMouseEnter={run} onFocus={run}>
            {out}
        </Tag>
    );
}

// IntersectionObserver reveal — paints a clip-path wipe.
// Fires a touch before the section enters the viewport for smoother feel.
function Reveal({ as: Tag = "section", children, className = "", delay = 0, ...rest }) {
    const ref = useRef(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        // If element is already in viewport at mount, reveal immediately.
        const initialRect = el.getBoundingClientRect();
        if (initialRect.top < window.innerHeight * 0.9) {
            setVisible(true);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setVisible(true);
                        observer.disconnect();
                    }
                });
            },
            { rootMargin: "0px 0px -10% 0px", threshold: 0 }
        );
        observer.observe(el);

        // Safety net: if observer somehow never fires, reveal on first scroll past.
        const onScroll = () => {
            const r = el.getBoundingClientRect();
            if (r.top < window.innerHeight * 0.9) {
                setVisible(true);
                window.removeEventListener("scroll", onScroll);
                observer.disconnect();
            }
        };
        window.addEventListener("scroll", onScroll, { passive: true });

        return () => {
            observer.disconnect();
            window.removeEventListener("scroll", onScroll);
        };
    }, []);

    return (
        <Tag
            ref={ref}
            className={`reveal ${className} ${visible ? "is-visible" : ""}`}
            style={{ transitionDelay: `${delay}ms` }}
            {...rest}
        >
            {children}
        </Tag>
    );
}

// Magnetic hover — moves content toward cursor within a small radius.
function Magnetic({ children, strength = 0.25, className = "" }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const handle = (e) => {
            const r = el.getBoundingClientRect();
            const x = e.clientX - (r.left + r.width / 2);
            const y = e.clientY - (r.top + r.height / 2);
            el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
        };
        const reset = () => {
            el.style.transform = "translate(0,0)";
        };
        el.addEventListener("mousemove", handle);
        el.addEventListener("mouseleave", reset);
        return () => {
            el.removeEventListener("mousemove", handle);
            el.removeEventListener("mouseleave", reset);
        };
    }, [strength]);
    return (
        <span ref={ref} className={`magnetic ${className}`}>
            {children}
        </span>
    );
}

const Home = () => {
    const { repos, activity, loading, error } = useGitHub();
    const [clock, setClock] = useState(new Date());
    const [scroll, setScroll] = useState(0);
    const heroRef = useRef(null);

    useEffect(() => {
        const id = setInterval(() => setClock(new Date()), 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        const handle = () => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            setScroll(max > 0 ? window.scrollY / max : 0);
        };
        handle();
        window.addEventListener("scroll", handle, { passive: true });
        return () => window.removeEventListener("scroll", handle);
    }, []);

    const displayRepos = repos.slice(0, 6);
    const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
    const yearLabel = clock.getFullYear();

    return (
        <main className="archive">
            {/* Top telemetry bar */}
            <header className="hud">
                <div className="hud__left">
                    <span className="hud__glyph" aria-hidden="true">◢</span>
                    <span className="hud__sig">JR.BUSSARD</span>
                    <span className="hud__sep">/</span>
                    <span className="hud__id">ARCHIVE.04</span>
                </div>
                <div className="hud__center">
                    <nav className="hud__nav" aria-label="Primary">
                        <a href="#works" data-cursor="VIEW">Works</a>
                        <a href="#transmissions" data-cursor="LIVE">Transmissions</a>
                        <a href="#repos" data-cursor="CODE">Repos</a>
                        <a href="#signal" data-cursor="HI">Signal</a>
                    </nav>
                </div>
                <div className="hud__right">
                    <span className="hud__blink" aria-hidden="true" />
                    <span className="hud__clock">{formatUTC(clock)}</span>
                </div>
                <div className="hud__progress" style={{ transform: `scaleX(${scroll})` }} />
            </header>

            {/* Hero */}
            <section className="hero" ref={heroRef} aria-labelledby="hero-title">
                <div className="hero__frame">
                    <div className="hero__corners" aria-hidden="true">
                        <span /><span /><span /><span />
                    </div>

                    <div className="hero__tag">
                        <span className="hero__tag-line" />
                        <span className="hero__tag-text">A one-man studio</span>
                    </div>

                    <h1 className="hero__title" id="hero-title">
                        <span className="hero__word">
                            <span className="hero__letter" style={{ "--i": 0 }}>B</span>
                            <span className="hero__letter" style={{ "--i": 1 }}>U</span>
                            <span className="hero__letter" style={{ "--i": 2 }}>S</span>
                            <span className="hero__letter" style={{ "--i": 3 }}>S</span>
                            <span className="hero__letter" style={{ "--i": 4 }}>A</span>
                            <span className="hero__letter" style={{ "--i": 5 }}>R</span>
                            <span className="hero__letter" style={{ "--i": 6 }}>D</span>
                        </span>
                        <span className="hero__amp" style={{ "--i": 7 }}>&amp;</span>
                        <span className="hero__word hero__word--italic">
                            <span className="hero__letter" style={{ "--i": 8 }}>c</span>
                            <span className="hero__letter" style={{ "--i": 9 }}>o</span>
                            <span className="hero__letter" style={{ "--i": 10 }}>.</span>
                        </span>
                    </h1>

                    <div className="hero__sub">
                        <p className="hero__kicker">
                            <span className="hero__kicker-dot" /> Builds things on nights &amp; weekends
                        </p>
                        <p className="hero__copy">
                            Websites, games, tools — whatever sounds fun. Day job at{" "}
                            <a href="https://cstonefl.com" target="_blank" rel="noreferrer" className="hero__inline" data-cursor="VISIT">
                                Cornerstone Companies
                            </a>
                            . Everything else lives here in the archive.
                        </p>
                    </div>

                    <div className="hero__signals">
                        {signals.map((s, i) => (
                            <span key={s.label} className="hero__chip" style={{ animationDelay: `${800 + i * 80}ms` }}>
                                <span className="hero__chip-dot" />
                                {s.label}
                            </span>
                        ))}
                    </div>

                    <div className="hero__scroll">
                        <span className="hero__scroll-label">Scroll</span>
                        <span className="hero__scroll-line" />
                    </div>
                </div>
            </section>

            {/* Ticker */}
            <div className="ticker" aria-hidden="true">
                <div className="ticker__track">
                    {Array.from({ length: 2 }).map((_, r) => (
                        <div className="ticker__row" key={r}>
                            <span>— Selected works {yearLabel}</span>
                            <span className="ticker__dot">◆</span>
                            <span>Nights &amp; weekends</span>
                            <span className="ticker__dot">◆</span>
                            <span>Built from West Palm Beach</span>
                            <span className="ticker__dot">◆</span>
                            <span>All systems nominal</span>
                            <span className="ticker__dot">◆</span>
                            <span>Transmitting on all frequencies</span>
                            <span className="ticker__dot">◆</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Works */}
            <Reveal as="section" className="section works" id="works" aria-labelledby="works-title">
                <header className="section__head">
                    <div className="section__tag">
                        <span className="section__num">001</span>
                        <span className="section__label">Selected Works</span>
                    </div>
                    <h2 id="works-title" className="section__title">
                        Things that exist <em>because I made them.</em>
                    </h2>
                </header>

                <ol className="works__list">
                    {featuredProjects.map((p, i) => (
                        <li key={p.title} className="work" style={{ "--delay": `${i * 90}ms` }}>
                            <a
                                href={p.href}
                                target="_blank"
                                rel="noreferrer"
                                className="work__link"
                                data-cursor="OPEN"
                            >
                                <span className="work__index">{p.index}</span>
                                <div className="work__body">
                                    <div className="work__header">
                                        <span className="work__kicker">{p.kicker} · {p.year}</span>
                                        <Scramble as="h3" className="work__title" text={p.title} />
                                    </div>
                                    <p className="work__desc">{p.description}</p>
                                </div>
                                <div className="work__meta">
                                    <div className="work__stack">
                                        {p.stack.map((t) => (
                                            <span key={t} className="work__stack-chip">{t}</span>
                                        ))}
                                    </div>
                                    <span className="work__domain">
                                        {p.domain}
                                        <span className="work__arrow" aria-hidden="true">↗</span>
                                    </span>
                                </div>
                                <span className="work__scan" aria-hidden="true" />
                                <span className="work__glow" aria-hidden="true" />
                            </a>
                        </li>
                    ))}
                </ol>
            </Reveal>

            {/* Transmissions */}
            <Reveal as="section" className="section transmissions" id="transmissions" aria-labelledby="transmissions-title">
                <header className="section__head section__head--split">
                    <div className="section__tag">
                        <span className="section__num">002</span>
                        <span className="section__label">Transmissions</span>
                    </div>
                    <h2 id="transmissions-title" className="section__title section__title--md">
                        Live commits from <em>the workbench.</em>
                    </h2>
                    <div className="transmissions__stat">
                        <span className="transmissions__stat-num">
                            {loading ? "—" : String(activity.length).padStart(2, "0")}
                        </span>
                        <span className="transmissions__stat-label">
                            recent · {loading ? "syncing" : "live"}
                        </span>
                    </div>
                </header>

                <div className="tx">
                    {loading && (
                        <div className="tx__status">
                            <span className="tx__spinner" />
                            Receiving transmissions…
                        </div>
                    )}
                    {error && (
                        <div className="tx__status tx__status--error">
                            ERR · could not reach GitHub — {error}
                        </div>
                    )}
                    {!loading && !error && activity.length === 0 && (
                        <div className="tx__status">No recent signal.</div>
                    )}
                    {!loading && !error && activity.length > 0 && (
                        <ol className="tx__list">
                            {activity.slice(0, 10).map((c, i) => (
                                <li key={`${c.sha}-${i}`} className="tx__row" style={{ "--i": i }}>
                                    <a
                                        href={c.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="tx__link"
                                        data-cursor="DIFF"
                                    >
                                        <span className="tx__time">{timeAgo(c.date).padStart(4, " ")}</span>
                                        <span className="tx__sha">{c.sha.slice(0, 7)}</span>
                                        <span className="tx__repo">{c.repo}</span>
                                        <span className="tx__msg">{c.message}</span>
                                        <span className="tx__arrow" aria-hidden="true">→</span>
                                    </a>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            </Reveal>

            {/* Repositories */}
            <Reveal as="section" className="section repos" id="repos" aria-labelledby="repos-title">
                <header className="section__head section__head--split">
                    <div className="section__tag">
                        <span className="section__num">003</span>
                        <span className="section__label">Repositories</span>
                    </div>
                    <h2 id="repos-title" className="section__title section__title--md">
                        Public shelves <em>on GitHub.</em>
                    </h2>
                    <div className="repos__stat">
                        <span className="repos__stat-row">
                            <span className="repos__stat-num">{repos.length || "—"}</span>
                            <span className="repos__stat-label">repos indexed</span>
                        </span>
                        <span className="repos__stat-row">
                            <span className="repos__stat-num">{totalStars || "—"}</span>
                            <span className="repos__stat-label">stars received</span>
                        </span>
                    </div>
                </header>

                {loading && <p className="repos__status">Indexing repositories…</p>}
                {!loading && (
                    <ol className="repos__grid">
                        {displayRepos.map((repo, i) => (
                            <li key={repo.id} className="repo" style={{ "--delay": `${i * 60}ms` }}>
                                <a
                                    href={repo.html_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="repo__link"
                                    data-cursor="CLONE"
                                >
                                    <div className="repo__head">
                                        <span className="repo__index">{String(i + 1).padStart(2, "0")}</span>
                                        <Scramble as="h3" className="repo__name" text={repo.name} />
                                    </div>
                                    {repo.description && (
                                        <p className="repo__desc">{repo.description}</p>
                                    )}
                                    <div className="repo__meta">
                                        {repo.language && (
                                            <span className="repo__lang">
                                                <span
                                                    className="repo__lang-dot"
                                                    style={{ background: langColors[repo.language] || "var(--bone-dim)" }}
                                                />
                                                {repo.language}
                                            </span>
                                        )}
                                        {repo.stargazers_count > 0 && (
                                            <span className="repo__stars">★ {repo.stargazers_count}</span>
                                        )}
                                        <span className="repo__updated">{timeAgo(repo.pushed_at)} ago</span>
                                    </div>
                                    <span className="repo__corner" aria-hidden="true" />
                                </a>
                            </li>
                        ))}
                    </ol>
                )}
            </Reveal>

            {/* Obsessions */}
            <Reveal as="section" className="section obsessions" aria-labelledby="obsessions-title">
                <header className="section__head">
                    <div className="section__tag">
                        <span className="section__num">004</span>
                        <span className="section__label">Obsessions</span>
                    </div>
                    <h2 id="obsessions-title" className="section__title">
                        Things I keep <em>thinking about.</em>
                    </h2>
                </header>

                <ul className="obsessions__list">
                    {obsessions.map((o, i) => (
                        <li key={o.n} className="obsession" style={{ "--delay": `${i * 90}ms` }} data-hover>
                            <span className="obsession__n">{o.n}</span>
                            <Scramble as="span" className="obsession__text" text={o.text} />
                            <span className="obsession__rule" />
                        </li>
                    ))}
                </ul>
            </Reveal>

            {/* Signal / contact */}
            <Reveal as="section" className="section signal" id="signal" aria-labelledby="signal-title">
                <header className="section__head">
                    <div className="section__tag">
                        <span className="section__num">005</span>
                        <span className="section__label">Signal</span>
                    </div>
                </header>

                <div className="signal__wrap">
                    <h2 className="signal__title" id="signal-title">
                        <span className="signal__l1">Got something</span>
                        <span className="signal__l2">worth building?</span>
                    </h2>
                    <div className="signal__cta-row">
                        <Magnetic strength={0.3}>
                            <a
                                className="signal__cta"
                                href="mailto:scottbussardjr@gmail.com"
                                data-cursor="SEND"
                            >
                                <span className="signal__cta-dot" />
                                <span className="signal__cta-text">Transmit →</span>
                            </a>
                        </Magnetic>
                        <div className="signal__links">
                            <a href={`https://github.com/${GITHUB_USER}`} target="_blank" rel="noreferrer" data-cursor="VISIT">
                                <Scramble text="github" />
                                <span className="signal__ext">↗</span>
                            </a>
                            <a href="https://linkedin.com/in/jr-bussard" target="_blank" rel="noreferrer" data-cursor="VISIT">
                                <Scramble text="linkedin" />
                                <span className="signal__ext">↗</span>
                            </a>
                            <a href="mailto:scottbussardjr@gmail.com" data-cursor="MAIL">
                                <Scramble text="email" />
                                <span className="signal__ext">↗</span>
                            </a>
                        </div>
                    </div>
                </div>
            </Reveal>

            {/* Footer */}
            <footer className="footline">
                <div className="footline__row">
                    <span>© JR Bussard {yearLabel}</span>
                    <span className="footline__dot">·</span>
                    <span>Built in West Palm Beach</span>
                    <span className="footline__dot">·</span>
                    <span>Archive v4.0</span>
                </div>
                <div className="footline__row footline__row--right">
                    <span>All systems nominal</span>
                    <span className="footline__pulse" />
                </div>
            </footer>
        </main>
    );
};

export default Home;

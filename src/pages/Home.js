import React, { useState, useEffect, useRef } from "react";
import { useGitHub } from "../hooks/useGitHub";
import "../styles/Home.css";

const GITHUB_USER = "pirut";

const featuredProjects = [
    {
        title: "Cornerstone Companies",
        label: "Day job",
        href: "https://cstonefl.com",
        domain: "cstonefl.com",
        description:
            "South Florida impact windows and doors. I got curious about the website and kept going.",
    },
    {
        title: "Meltdown",
        label: "Side project",
        href: "https://meltdown.jrbussard.com",
        domain: "meltdown.jrbussard.com",
        description:
            "Parents share why their kid had a meltdown today. Made it because the stories are too funny not to have a place for them.",
    },
    {
        title: "Make Waves",
        label: "Side project",
        href: "https://waves.jrbussard.com",
        domain: "waves.jrbussard.com",
        description:
            "Built this for friends who organize community events. Helps them keep things moving between campaigns.",
    },
];

const pursuits = [
    "Seeing how far AI tools can take an idea",
    "Browser games I'd actually want to play",
    "Making useful things for people I know",
];

const langColors = {
    JavaScript: "#d9b94a",
    TypeScript: "#2f5ea8",
    HTML: "#c0452a",
    CSS: "#5c3c86",
    Python: "#2e5d85",
    Java: "#986326",
    Go: "#1d8ca8",
    Rust: "#b8744a",
    Ruby: "#6a1316",
    Shell: "#6f9e38",
    C: "#4a4a4a",
    "C++": "#c33a67",
    "C#": "#186116",
    PHP: "#404f7d",
    Swift: "#c44631",
    Kotlin: "#7b54c7",
};

function timeAgo(dateStr) {
    const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}

function Reveal({ as: Tag = "section", children, className = "", delay = 0, ...rest }) {
    const ref = useRef(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.08 }
        );
        observer.observe(el);
        return () => observer.disconnect();
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

const Home = () => {
    const heroSrc = `${process.env.PUBLIC_URL}/assets/hero.jpg`;
    const { repos, activity, loading, error } = useGitHub();
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60000);
        return () => clearInterval(id);
    }, []);

    const dateLabel = now.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
    });

    const displayRepos = repos.slice(0, 6);

    return (
        <main className="journal">
            <svg className="grain" aria-hidden="true">
                <filter id="paper-grain">
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.82"
                        numOctaves="2"
                        stitchTiles="stitch"
                    />
                    <feColorMatrix
                        type="matrix"
                        values="0 0 0 0 0.05
                                0 0 0 0 0.04
                                0 0 0 0 0.02
                                0 0 0 0.7 0"
                    />
                </filter>
                <rect width="100%" height="100%" filter="url(#paper-grain)" />
            </svg>

            <header className="masthead">
                <h1 className="masthead__title" aria-label="JR Bussard">
                    <span className="masthead__title-jr">JR</span>
                    <span className="masthead__title-bussard">Bussard</span>
                </h1>
                <span className="masthead__date">{dateLabel}</span>
            </header>

            <hr className="rule rule--heavy" aria-hidden="true" />

            <section className="hero">
                <div className="hero__text">
                    <h2 className="hero__headline">
                        <span className="hero__line">Builds things</span>
                        <span className="hero__line hero__line--italic">
                            on nights &amp; weekends.
                        </span>
                    </h2>
                    <p className="hero__sub">
                        Websites, games, tools &mdash; whatever sounds fun.
                        I work at Cornerstone Companies by day and tinker with
                        this stuff the rest of the time.
                    </p>
                </div>
                <figure className="hero__portrait">
                    <img src={heroSrc} alt="JR Bussard" loading="eager" />
                </figure>
            </section>

            <hr className="rule" aria-hidden="true" />

            <Reveal className="article" aria-labelledby="projects-title">
                <header className="article__head">
                    <span className="article__num">01</span>
                    <h2 id="projects-title">Projects</h2>
                </header>

                <div className="works">
                    {featuredProjects.map((project, i) => (
                        <a
                            key={project.title}
                            href={project.href}
                            target="_blank"
                            rel="noreferrer"
                            className="work"
                            style={{ animationDelay: `${i * 80 + 120}ms` }}
                        >
                            <span className="work__label">{project.label}</span>
                            <h3 className="work__title">{project.title}</h3>
                            <p className="work__desc">{project.description}</p>
                            <span className="work__domain">
                                {project.domain}
                                <span className="work__arrow" aria-hidden="true">
                                    ↗
                                </span>
                            </span>
                        </a>
                    ))}
                </div>
            </Reveal>

            <hr className="rule" aria-hidden="true" />

            <Reveal className="article" aria-labelledby="activity-title" delay={60}>
                <header className="article__head">
                    <span className="article__num">02</span>
                    <h2 id="activity-title">Recent activity</h2>
                </header>

                <div className="feed">
                    {loading && <div className="feed__status">Loading…</div>}
                    {error && (
                        <div className="feed__status feed__status--error">
                            Couldn&rsquo;t reach GitHub — {error}
                        </div>
                    )}
                    {!loading && !error && activity.length === 0 && (
                        <div className="feed__status">Nothing recent.</div>
                    )}
                    {!loading && !error && activity.length > 0 && (
                        <ol className="feed__list">
                            {activity.map((commit, i) => (
                                <li key={`${commit.sha}-${i}`} style={{ animationDelay: `${i * 40}ms` }}>
                                    <a href={commit.url} target="_blank" rel="noreferrer" className="feed__entry">
                                        <span className="feed__body">
                                            <span className="feed__message">{commit.message}</span>
                                            <span className="feed__meta">
                                                <span className="feed__repo">{commit.repo}</span>
                                                <span className="feed__dot" aria-hidden="true">·</span>
                                                <span className="feed__sha">{commit.sha.slice(0, 7)}</span>
                                                <span className="feed__dot" aria-hidden="true">·</span>
                                                <span className="feed__time">{timeAgo(commit.date)}</span>
                                            </span>
                                        </span>
                                        <span className="feed__arrow" aria-hidden="true">↗</span>
                                    </a>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            </Reveal>

            <hr className="rule" aria-hidden="true" />

            <Reveal className="article" aria-labelledby="repos-title" delay={60}>
                <header className="article__head">
                    <span className="article__num">03</span>
                    <h2 id="repos-title">Repositories</h2>
                </header>

                {loading && <p className="stacks__status">Loading…</p>}
                {!loading && (
                    <ol className="stacks">
                        {displayRepos.map((repo, i) => (
                            <li key={repo.id} style={{ animationDelay: `${i * 50 + 80}ms` }}>
                                <a href={repo.html_url} target="_blank" rel="noreferrer" className="stack">
                                    <h3 className="stack__name">{repo.name}</h3>
                                    {repo.description && (
                                        <p className="stack__desc">{repo.description}</p>
                                    )}
                                    <div className="stack__meta">
                                        {repo.language && (
                                            <span className="stack__lang">
                                                <span
                                                    className="stack__lang-dot"
                                                    style={{
                                                        background:
                                                            langColors[repo.language] ||
                                                            "var(--ink-muted)",
                                                    }}
                                                />
                                                {repo.language}
                                            </span>
                                        )}
                                        {repo.stargazers_count > 0 && (
                                            <span className="stack__stars">★ {repo.stargazers_count}</span>
                                        )}
                                        <span className="stack__updated">{timeAgo(repo.pushed_at)}</span>
                                    </div>
                                </a>
                            </li>
                        ))}
                    </ol>
                )}
            </Reveal>

            <hr className="rule" aria-hidden="true" />

            <Reveal className="article" aria-labelledby="pursuits-title" delay={60}>
                <header className="article__head">
                    <span className="article__num">04</span>
                    <h2 id="pursuits-title">What I&rsquo;m into</h2>
                </header>

                <ul className="pursuits">
                    {pursuits.map((p, i) => (
                        <li key={p} style={{ animationDelay: `${i * 80 + 100}ms` }}>
                            <span className="pursuits__arrow" aria-hidden="true">→</span>
                            {p}
                        </li>
                    ))}
                </ul>
            </Reveal>

            <hr className="rule rule--heavy" aria-hidden="true" />

            <footer className="footer">
                <span>© JR Bussard {now.getFullYear()}</span>
                <span className="footer__sep" aria-hidden="true">·</span>
                <a href={`https://github.com/${GITHUB_USER}`} target="_blank" rel="noreferrer">
                    github.com/{GITHUB_USER}
                </a>
            </footer>
        </main>
    );
};

export default Home;

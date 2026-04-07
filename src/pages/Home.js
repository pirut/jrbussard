import React, { useState, useEffect, useRef } from "react";
import { useGitHub } from "../hooks/useGitHub";
import "../styles/Home.css";

const GITHUB_USER = "pirut";

const featuredProjects = [
    {
        title: "Cornerstone Companies",
        label: "Day job",
        href: "https://cstonefl.com",
        description:
            "South Florida impact windows and doors. I got curious about the website and kept going.",
    },
    {
        title: "Meltdown",
        label: "Side project",
        href: "https://meltdown.jrbussard.com",
        description:
            "Parents share why their kid had a meltdown today. Made it because the stories are too funny not to have a place for them.",
    },
    {
        title: "Make Waves",
        label: "Side project",
        href: "https://waves.jrbussard.com",
        description:
            "Built this for friends who organize community events. Helps them keep things moving between campaigns.",
    },
];

const focusAreas = [
    "Seeing how far AI tools can take an idea",
    "Browser games I'd actually want to play",
    "Making useful things for people I know",
];

const langColors = {
    JavaScript: "#f1e05a",
    TypeScript: "#3178c6",
    HTML: "#e34c26",
    CSS: "#563d7c",
    Python: "#3572A5",
    Java: "#b07219",
    Go: "#00ADD8",
    Rust: "#dea584",
    Ruby: "#701516",
    Shell: "#89e051",
    C: "#555555",
    "C++": "#f34b7d",
    "C#": "#178600",
    PHP: "#4F5D95",
    Swift: "#F05138",
    Kotlin: "#A97BFF",
};

function timeAgo(dateStr) {
    const seconds = Math.floor((Date.now() - new Date(dateStr)) / 1000);
    if (seconds < 60) return `${seconds}S AGO`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}M AGO`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}H AGO`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}D AGO`;
    const months = Math.floor(days / 30);
    return `${months}MO AGO`;
}

/* Scroll-triggered reveal wrapper */
function Section({ children, className = "", delay = 0, ...props }) {
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
        <section
            ref={ref}
            className={`bsection ${className} ${visible ? "is-visible" : ""}`}
            style={{ transitionDelay: `${delay}ms` }}
            {...props}
        >
            {children}
        </section>
    );
}

const Home = () => {
    const heroSrc = `${process.env.PUBLIC_URL}/assets/hero.jpg`;
    const { repos, activity, loading, error } = useGitHub();
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const interval = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    const displayRepos = repos.slice(0, 6);

    return (
        <main className="home">
            {/* Grain noise overlay */}
            <svg className="grain" aria-hidden="true">
                <filter id="grain-filter">
                    <feTurbulence
                        type="fractalNoise"
                        baseFrequency="0.65"
                        numOctaves="3"
                        stitchTiles="stitch"
                    />
                </filter>
                <rect
                    width="100%"
                    height="100%"
                    filter="url(#grain-filter)"
                />
            </svg>

            {/* CRT scan lines */}
            <div className="scanlines" aria-hidden="true" />

            {/* Status bar */}
            <header className="status-bar">
                <span className="status-bar__name">JR BUSSARD</span>
                <span className="status-bar__status">
                    <span className="status-dot" /> ONLINE
                </span>
                <span className="status-bar__time">
                    {time.toLocaleTimeString("en-US", {
                        hour12: false,
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                    })}
                </span>
            </header>

            {/* Hero */}
            <section className="hero" aria-labelledby="home-title">
                <div className="hero__text">
                    <h1 id="home-title">
                        <span className="hero__line">JUST A GUY</span>
                        <span className="hero__line">WHO LIKES TO</span>
                        <span className="hero__line">
                            BUILD THINGS
                            <span className="accent-dot">.</span>
                        </span>
                    </h1>
                    <p className="hero__sub">
                        Websites, games, tools — whatever sounds fun.
                        I work at Cornerstone Companies by day and tinker
                        with this stuff the rest of the time.
                    </p>
                </div>
                <figure className="hero__media">
                    <img src={heroSrc} alt="JR Bussard" loading="eager" />
                    <div className="hero__media-border" aria-hidden="true" />
                </figure>
            </section>

            <div className="divider" aria-hidden="true" />

            {/* Projects */}
            <Section aria-labelledby="projects-title">
                <div className="section__header">
                    <span className="section__number">01</span>
                    <h2 id="projects-title">PROJECTS</h2>
                </div>
                <div className="project-grid">
                    {featuredProjects.map((project, i) => (
                        <a
                            key={project.title}
                            href={project.href}
                            target="_blank"
                            rel="noreferrer"
                            className="project-card"
                            style={{ animationDelay: `${i * 100 + 200}ms` }}
                        >
                            <span className="project-card__label">
                                {project.label}
                            </span>
                            <h3 className="project-card__title">
                                {project.title}
                            </h3>
                            <p className="project-card__desc">
                                {project.description}
                            </p>
                            <span className="project-card__link">
                                OPEN SITE{" "}
                                <span className="arrow">&rarr;</span>
                            </span>
                        </a>
                    ))}
                </div>
            </Section>

            <div className="divider" aria-hidden="true" />

            {/* GitHub Live Feed */}
            <Section aria-labelledby="feed-title" delay={100}>
                <div className="section__header">
                    <span className="section__number">02</span>
                    <h2 id="feed-title">RECENT ACTIVITY</h2>
                    <span className="live-badge">
                        <span className="live-dot" /> LIVE
                    </span>
                </div>
                <div className="terminal">
                    {loading && (
                        <div className="terminal__status">
                            <span className="blink">
                                FETCHING GITHUB DATA...
                            </span>
                        </div>
                    )}
                    {error && (
                        <div className="terminal__status terminal__error">
                            <span className="terminal__prefix">!</span>{" "}
                            CONNECTION FAILED &mdash; {error}
                        </div>
                    )}
                    {!loading &&
                        !error &&
                        activity.length === 0 && (
                            <div className="terminal__status">
                                NO RECENT ACTIVITY
                            </div>
                        )}
                    {!loading &&
                        !error &&
                        activity.map((commit, i) => (
                            <a
                                key={`${commit.sha}-${i}`}
                                href={commit.url}
                                target="_blank"
                                rel="noreferrer"
                                className="terminal__line"
                                style={{
                                    animationDelay: `${i * 60}ms`,
                                }}
                            >
                                <div className="terminal__line-main">
                                    <span className="terminal__sha">
                                        {commit.sha.slice(0, 7)}
                                    </span>
                                    <span className="terminal__repo">
                                        {commit.repo}
                                    </span>
                                    <span className="terminal__time">
                                        {timeAgo(commit.date)}
                                    </span>
                                </div>
                                <div className="terminal__detail">
                                    {commit.message}
                                </div>
                            </a>
                        ))}
                    <div className="terminal__cursor" aria-hidden="true">
                        <span className="blink">&block;</span>
                    </div>
                </div>
            </Section>

            <div className="divider" aria-hidden="true" />

            {/* Repositories */}
            <Section aria-labelledby="repos-title" delay={100}>
                <div className="section__header">
                    <span className="section__number">03</span>
                    <h2 id="repos-title">REPOSITORIES</h2>
                </div>
                {loading && (
                    <p className="loading-text">
                        <span className="blink">LOADING...</span>
                    </p>
                )}
                {!loading && (
                    <div className="repo-grid">
                        {displayRepos.map((repo, i) => (
                            <a
                                key={repo.id}
                                href={repo.html_url}
                                target="_blank"
                                rel="noreferrer"
                                className="repo-card"
                                style={{
                                    animationDelay: `${i * 80 + 100}ms`,
                                }}
                            >
                                <h3 className="repo-card__name">
                                    {repo.name}
                                </h3>
                                {repo.description && (
                                    <p className="repo-card__desc">
                                        {repo.description}
                                    </p>
                                )}
                                <div className="repo-card__meta">
                                    {repo.language && (
                                        <span className="repo-card__lang">
                                            <span
                                                className="lang-dot"
                                                style={{
                                                    background:
                                                        langColors[
                                                            repo.language
                                                        ] || "#888",
                                                }}
                                            />
                                            {repo.language}
                                        </span>
                                    )}
                                    {repo.stargazers_count > 0 && (
                                        <span className="repo-card__stars">
                                            &#9733; {repo.stargazers_count}
                                        </span>
                                    )}
                                    <span className="repo-card__updated">
                                        {timeAgo(repo.pushed_at)}
                                    </span>
                                </div>
                            </a>
                        ))}
                    </div>
                )}
            </Section>

            <div className="divider" aria-hidden="true" />

            {/* Focus */}
            <Section aria-labelledby="focus-title" delay={100}>
                <div className="section__header">
                    <span className="section__number">04</span>
                    <h2 id="focus-title">WHAT I'M INTO</h2>
                </div>
                <ul className="focus-list">
                    {focusAreas.map((area, i) => (
                        <li
                            key={area}
                            style={{
                                animationDelay: `${i * 80 + 200}ms`,
                            }}
                        >
                            <span className="focus-arrow">&rarr;</span> {area}
                        </li>
                    ))}
                </ul>
            </Section>

            {/* Footer */}
            <footer className="bfooter">
                <div className="bfooter__inner">
                    <span>BUILT WITH AI + CURIOSITY</span>
                    <span className="bfooter__sep">/</span>
                    <span>HOSTED ON VERCEL</span>
                    <span className="bfooter__sep">/</span>
                    <span>
                        <a
                            href={`https://github.com/${GITHUB_USER}`}
                            target="_blank"
                            rel="noreferrer"
                        >
                            GITHUB/{GITHUB_USER.toUpperCase()}
                        </a>
                    </span>
                </div>
            </footer>
        </main>
    );
};

export default Home;

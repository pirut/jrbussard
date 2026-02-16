import React from "react";
import "../styles/Home.css";

const featuredProjects = [
    {
        title: "Land",
        label: "Browser MMO",
        href: "https://land.jrbussard.com",
        description: "A low-fi persistent world with deep progression loops and emergent player economies.",
        tone: "signal",
    },
    {
        title: "Make Waves",
        label: "Social Impact Platform",
        href: "https://waves.jrbussard.com",
        description: "Event-driven community organizing built to help people host local action at scale.",
        tone: "ember",
    },
    {
        title: "Start A Build",
        label: "Open for New Work",
        href: "#connect",
        description: "Need a product pushed from concept to launch? I build fast with production rigor.",
        tone: "ink",
    },
];

const capabilities = [
    "Product design systems and frontend architecture",
    "Browser games and mechanics-heavy interfaces",
    "Internal tools and practical automation",
    "Rapid prototyping with production handoff",
];

const timeline = [
    {
        year: "Now",
        title: "Shipping direct-to-user products",
        copy: "Building useful web software with a focus on clarity, performance, and memorable UX.",
    },
    {
        year: "Recent",
        title: "Social impact platform launch",
        copy: "Delivered tooling that helps people create and coordinate community events.",
    },
    {
        year: "Ongoing",
        title: "Game systems experiments",
        copy: "Prototyping multiplayer loops, economy balancing, and progression design for the web.",
    },
];

const Home = () => {
    const heroSrc = `${process.env.PUBLIC_URL}/assets/hero.jpg`;

    return (
        <main className="home">
            <section className="hero-panel reveal reveal--1" aria-labelledby="home-title">
                <div className="hero-panel__left">
                    <p className="eyebrow">JR BUSSARD</p>
                    <h1 id="home-title" className="display-title">
                        Digital products with grit, style, and momentum.
                    </h1>
                    <p className="hero-copy">
                        I design and ship web experiences that feel handcrafted, perform fast, and solve real problems.
                    </p>
                    <div className="hero-actions">
                        <a className="action action--primary" href="https://land.jrbussard.com" target="_blank" rel="noreferrer">
                            Explore Land
                        </a>
                        <a className="action action--secondary" href="#work">
                            View Work
                        </a>
                    </div>
                </div>
                <aside className="hero-panel__right" aria-label="Profile media and metadata">
                    <figure className="portrait-frame">
                        <img src={heroSrc} alt="JR Bussard portrait" loading="lazy" />
                    </figure>
                    <div className="meta-chip-row">
                        <span>Based in the US</span>
                        <span>Frontend + Product</span>
                        <span>Available for builds</span>
                    </div>
                </aside>
            </section>

            <section className="capability-band reveal reveal--2" aria-label="Capabilities">
                {capabilities.map((capability) => (
                    <p key={capability}>{capability}</p>
                ))}
            </section>

            <section id="work" className="projects reveal reveal--3" aria-labelledby="projects-title">
                <div className="section-header">
                    <p className="eyebrow">Featured Work</p>
                    <h2 id="projects-title">Built for humans, not dashboards.</h2>
                </div>
                <div className="project-grid">
                    {featuredProjects.map((project) => (
                        <article key={project.title} className={`project-card project-card--${project.tone}`}>
                            <p className="project-label">{project.label}</p>
                            <h3>{project.title}</h3>
                            <p>{project.description}</p>
                            <a href={project.href} target={project.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                                Open project
                            </a>
                        </article>
                    ))}
                </div>
            </section>

            <section className="story reveal reveal--4" aria-labelledby="story-title">
                <div className="section-header">
                    <p className="eyebrow">Current Arc</p>
                    <h2 id="story-title">What I am shipping right now.</h2>
                </div>
                <div className="timeline">
                    {timeline.map((item) => (
                        <article key={item.title} className="timeline-item">
                            <p className="timeline-item__year">{item.year}</p>
                            <h3>{item.title}</h3>
                            <p>{item.copy}</p>
                        </article>
                    ))}
                </div>
            </section>

            <section id="connect" className="connect reveal reveal--5" aria-labelledby="connect-title">
                <p className="eyebrow">Collaboration</p>
                <h2 id="connect-title">Need a high-velocity build partner?</h2>
                <p>
                    Bring me the problem statement and target outcome. I will map the product, design the interface, and ship the first version fast.
                </p>
                <a className="action action--primary" href="https://land.jrbussard.com" target="_blank" rel="noreferrer">
                    Start the conversation
                </a>
            </section>
        </main>
    );
};

export default Home;

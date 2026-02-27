import React from "react";
import "../styles/Home.css";

const featuredProjects = [
    {
        title: "Cornerstone Companies",
        label: "Main job",
        href: "https://cstonefl.com",
        description:
            "Building Cornerstone Companies, a South Florida luxury impact windows and doors company delivering design-forward, high-performance fenestration solutions.",
    },
    {
        title: "Land",
        label: "Side project",
        href: "https://land.jrbussard.com",
        description: "A persistent browser world focused on progression systems, player economies, and long-term experimentation.",
    },
    {
        title: "Make Waves",
        label: "Side project",
        href: "https://waves.jrbussard.com",
        description: "A platform for community organizers to host events, coordinate participants, and keep momentum between campaigns.",
    },
];

const focusAreas = [
    "Readable, durable frontend systems",
    "Game mechanics and progression loops for the web",
    "Tools that help communities organize action",
];

const Home = () => {
    const heroSrc = `${process.env.PUBLIC_URL}/assets/hero.jpg`;

    return (
        <main className="home">
            <section className="hero" aria-labelledby="home-title">
                <div className="hero__text">
                    <p className="kicker">JR BUSSARD</p>
                    <h1 id="home-title">Building clear, useful web projects.</h1>
                    <p>
                        I am building Cornerstone Companies as my main job, alongside side projects in games, social platforms, and practical tools.
                    </p>
                </div>
                <figure className="hero__media">
                    <img src={heroSrc} alt="JR Bussard portrait" loading="lazy" />
                </figure>
            </section>

            <section className="section" aria-labelledby="projects-title">
                <h2 id="projects-title">Main job and side projects</h2>
                <div className="project-list">
                    {featuredProjects.map((project) => (
                        <article key={project.title} className="project-item">
                            <p className="project-item__label">{project.label}</p>
                            <h3>{project.title}</h3>
                            <p>{project.description}</p>
                            <a href={project.href} target="_blank" rel="noreferrer">
                                Open site
                            </a>
                        </article>
                    ))}
                </div>
            </section>

            <section className="section" aria-labelledby="focus-title">
                <h2 id="focus-title">Current focus</h2>
                <ul className="focus-list">
                    {focusAreas.map((area) => (
                        <li key={area}>{area}</li>
                    ))}
                </ul>
            </section>
        </main>
    );
};

export default Home;

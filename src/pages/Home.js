import React from "react";
import { Link } from "react-router-dom";

const Home = () => {
    return (
        <div className="home-page">
            <div className="hero-section">
                <div className="hero-content">
                    <h1 className="hero-title ibm-plex-sans-regular">
                        Hey there! I'm <span className="highlight">JR</span>
                    </h1>
                    <h2 className="hero-subtitle">Just a dude who likes to code</h2>
                    <p className="hero-description">
                        Welcome to my little corner of the internet! This is where I mess around with code, build random stuff, and share my adventures in
                        programming. No corporate vibes here - just pure coding fun! 🚀
                    </p>
                    <div className="hero-buttons">
                        <Link to="/projects" className="btn primary-btn">
                            Check Out My Projects
                        </Link>
                        <Link to="/contact" className="btn secondary-btn">
                            Say Hi!
                        </Link>
                    </div>
                </div>
                <div className="hero-image-container">
                    <div className="hero-image placeholder"></div>
                </div>
            </div>

            <div className="home-sections">
                <section className="highlight-section">
                    <h2 className="section-title">What I'm Up To</h2>
                    <div className="services-grid">
                        <div className="service-card">
                            <div className="service-icon">🎮</div>
                            <h3>Game Development</h3>
                            <p>Building fun little games and interactive experiences.</p>
                        </div>
                        <div className="service-card">
                            <div className="service-icon">🤖</div>
                            <h3>AI Experiments</h3>
                            <p>Playing around with AI and machine learning stuff.</p>
                        </div>
                        <div className="service-card">
                            <div className="service-icon">🔧</div>
                            <h3>Random Tools</h3>
                            <p>Creating useful (and sometimes not so useful) tools.</p>
                        </div>
                    </div>
                </section>

                <section className="featured-work">
                    <h2 className="section-title">Latest Creation</h2>
                    <div className="featured-project">
                        <div className="featured-project-image placeholder"></div>
                        <div className="featured-project-content">
                            <h3>My Latest Project</h3>
                            <p>Check out what I've been tinkering with lately. It might be useful, it might be silly, but it's definitely fun!</p>
                            <Link to="/projects" className="featured-link">
                                Take a Look
                            </Link>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Home;

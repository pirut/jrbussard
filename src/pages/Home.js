import React from "react";
import { Link } from "react-router-dom";

const Home = () => {
    return (
        <div className="home-page">
            <div className="hero-section">
                <div className="hero-content">
                    <h1 className="hero-title ibm-plex-sans-regular">
                        Hi, I'm <span className="highlight">JR Bussard</span>
                    </h1>
                    <h2 className="hero-subtitle">Full Stack Developer</h2>
                    <p className="hero-description">
                        I build modern web applications with a focus on user experience, performance, and clean code. Let's turn your ideas into reality.
                    </p>
                    <div className="hero-buttons">
                        <Link to="/projects" className="btn primary-btn">
                            View My Work
                        </Link>
                        <Link to="/contact" className="btn secondary-btn">
                            Get In Touch
                        </Link>
                    </div>
                </div>
                <div className="hero-image-container">
                    <div className="hero-image placeholder"></div>
                </div>
            </div>

            <div className="home-sections">
                <section className="highlight-section">
                    <h2 className="section-title">What I Do</h2>
                    <div className="services-grid">
                        <div className="service-card">
                            <div className="service-icon">💻</div>
                            <h3>Web Development</h3>
                            <p>Creating responsive, user-friendly websites with modern frameworks.</p>
                        </div>
                        <div className="service-card">
                            <div className="service-icon">🎨</div>
                            <h3>UI/UX Design</h3>
                            <p>Designing intuitive interfaces that improve user experience.</p>
                        </div>
                        <div className="service-card">
                            <div className="service-icon">📱</div>
                            <h3>Mobile Solutions</h3>
                            <p>Building cross-platform applications that work seamlessly on all devices.</p>
                        </div>
                    </div>
                </section>

                <section className="featured-work">
                    <h2 className="section-title">Featured Work</h2>
                    <div className="featured-project">
                        <div className="featured-project-image placeholder"></div>
                        <div className="featured-project-content">
                            <h3>Recent Project</h3>
                            <p>A brief description of one of your most impressive or recent projects.</p>
                            <Link to="/projects" className="featured-link">
                                View Project Details
                            </Link>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Home;

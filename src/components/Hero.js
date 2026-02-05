import React from "react";
import "../styles/Hero.css";

const Hero = () => {
    const heroSrc = `${process.env.PUBLIC_URL}/assets/hero.jpg`;

    return (
        <section className="hero">
            <div className="hero__content">
                <h1 className="hero__name">JR Bussard</h1>
                <p className="hero__description">Building modern web experiments, games, and useful tools.</p>
                <div className="hero__project">
                    <p className="hero__project-label">New project</p>
                    <a className="hero__project-link" href="https://land.jrbussard.com" target="_blank" rel="noreferrer">
                        land.jrbussard.com
                    </a>
                    <p className="hero__project-copy">
                        A browser-based MMO with simple graphics and extremely deep systems for building and progression.
                    </p>
                </div>
            </div>
            <div className="hero__media">
                <div className="hero__frame">
                    <img className="hero__image" src={heroSrc} alt="JR Bussard" loading="lazy" />
                </div>
            </div>
        </section>
    );
};

export default Hero;

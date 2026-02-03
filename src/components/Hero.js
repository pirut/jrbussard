import React from "react";
import "../styles/Hero.css";

const Hero = () => {
    const heroSrc = `${process.env.PUBLIC_URL}/assets/hero.jpg`;

    return (
        <section className="hero">
            <div className="hero__content">
                <h1 className="hero__name">JR Bussard</h1>
                <p className="hero__description">Building modern web experiments, games, and useful tools.</p>
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

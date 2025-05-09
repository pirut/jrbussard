import React from "react";

const About = () => {
    return (
        <div className="about-page">
            <div className="about-container">
                <div className="about-intro">
                    <div className="profile-image-container">
                        <div className="profile-image placeholder"></div>
                    </div>
                    <div className="about-summary">
                        <h1 className="page-title ibm-plex-sans-regular">About Me</h1>
                        <p className="job-title">Code Enthusiast & Problem Solver</p>
                        <p className="about-description">
                            Hey! I'm just a regular person who loves playing with code and building cool stuff. I'm not here to sell you anything or pretend to
                            be some coding guru. I just enjoy the process of creating things and solving puzzles with code. Whether it's a silly game, a useful
                            tool, or just experimenting with new technologies, I'm always up for a coding adventure! 🚀
                        </p>
                    </div>
                </div>

                <section className="about-section">
                    <h3 className="section-title">My Toolbox</h3>
                    <div className="skills-container">
                        <div className="skill-category">
                            <h4>Frontend Fun</h4>
                            <ul className="skills-list">
                                <li>React</li>
                                <li>JavaScript</li>
                                <li>HTML/CSS</li>
                                <li>Three.js</li>
                                <li>Canvas</li>
                            </ul>
                        </div>
                        <div className="skill-category">
                            <h4>Backend Basics</h4>
                            <ul className="skills-list">
                                <li>Node.js</li>
                                <li>Python</li>
                                <li>SQL</li>
                                <li>APIs</li>
                            </ul>
                        </div>
                        <div className="skill-category">
                            <h4>Cool Tools</h4>
                            <ul className="skills-list">
                                <li>Git</li>
                                <li>VS Code</li>
                                <li>Docker</li>
                                <li>Linux</li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section className="about-section">
                    <h3 className="section-title">My Journey</h3>
                    <div className="experience-container">
                        <div className="experience-item">
                            <div className="experience-header">
                                <h4>Current Adventures</h4>
                                <span className="experience-date">2020 - Present</span>
                            </div>
                            <p className="company-name">Personal Projects & Experiments</p>
                            <ul className="experience-details">
                                <li>Building fun games and interactive experiences</li>
                                <li>Experimenting with AI and machine learning</li>
                                <li>Creating useful tools and utilities</li>
                            </ul>
                        </div>

                        <div className="experience-item">
                            <div className="experience-header">
                                <h4>Learning Phase</h4>
                                <span className="experience-date">2017 - 2020</span>
                            </div>
                            <p className="company-name">Self-Taught Journey</p>
                            <ul className="experience-details">
                                <li>Started with web development basics</li>
                                <li>Explored various programming languages</li>
                                <li>Built my first projects and tools</li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section className="about-section">
                    <h3 className="section-title">Education</h3>
                    <div className="education-container">
                        <div className="education-item">
                            <div className="education-header">
                                <h4>Self-Taught Developer</h4>
                                <span className="education-date">Ongoing</span>
                            </div>
                            <p className="institution-name">School of Internet & Stack Overflow</p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default About;

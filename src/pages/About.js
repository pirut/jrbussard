import React from "react";

const About = () => {
    return (
        <div className="about-page">
            <h1 className="page-title ibm-plex-sans-regular">About Me</h1>

            <div className="about-container">
                <div className="about-intro">
                    <div className="profile-image-container">
                        <div className="profile-image placeholder"></div>
                    </div>
                    <div className="about-summary">
                        <h2>JR Bussard</h2>
                        <p className="job-title">Full Stack Developer</p>
                        <p className="about-description">
                            I'm a passionate developer with experience in building web applications using modern technologies. I focus on creating clean,
                            efficient code and intuitive user experiences.
                        </p>
                    </div>
                </div>

                <section className="about-section">
                    <h3 className="section-title">Skills</h3>
                    <div className="skills-container">
                        <div className="skill-category">
                            <h4>Frontend</h4>
                            <ul className="skills-list">
                                <li>React</li>
                                <li>JavaScript</li>
                                <li>HTML5</li>
                                <li>CSS3</li>
                                <li>Responsive Design</li>
                            </ul>
                        </div>
                        <div className="skill-category">
                            <h4>Backend</h4>
                            <ul className="skills-list">
                                <li>Node.js</li>
                                <li>Express</li>
                                <li>MongoDB</li>
                                <li>RESTful APIs</li>
                            </ul>
                        </div>
                        <div className="skill-category">
                            <h4>Tools</h4>
                            <ul className="skills-list">
                                <li>Git</li>
                                <li>VS Code</li>
                                <li>Figma</li>
                                <li>Jest</li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section className="about-section">
                    <h3 className="section-title">Experience</h3>
                    <div className="experience-container">
                        <div className="experience-item">
                            <div className="experience-header">
                                <h4>Senior Web Developer</h4>
                                <span className="experience-date">2020 - Present</span>
                            </div>
                            <p className="company-name">Tech Solutions Inc.</p>
                            <ul className="experience-details">
                                <li>Lead frontend development for multiple client projects</li>
                                <li>Implemented responsive designs and improved user experience</li>
                                <li>Mentored junior developers and conducted code reviews</li>
                            </ul>
                        </div>

                        <div className="experience-item">
                            <div className="experience-header">
                                <h4>Web Developer</h4>
                                <span className="experience-date">2017 - 2020</span>
                            </div>
                            <p className="company-name">Digital Creations LLC</p>
                            <ul className="experience-details">
                                <li>Built and maintained client websites and applications</li>
                                <li>Collaborated with designers to implement UI/UX improvements</li>
                                <li>Integrated third-party APIs and services</li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section className="about-section">
                    <h3 className="section-title">Education</h3>
                    <div className="education-container">
                        <div className="education-item">
                            <div className="education-header">
                                <h4>Bachelor of Science in Computer Science</h4>
                                <span className="education-date">2013 - 2017</span>
                            </div>
                            <p className="institution-name">University of Technology</p>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default About;

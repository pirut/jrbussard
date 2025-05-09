import React from "react";

const Projects = () => {
    return (
        <div className="projects-page">
            <h1 className="page-title ibm-plex-sans-regular">My Projects</h1>
            <p className="projects-intro">Here are some of the projects I've worked on recently.</p>

            <div className="projects-grid">
                <div className="project-card">
                    <div className="project-image placeholder"></div>
                    <div className="project-content">
                        <h2>Personal Portfolio Website</h2>
                        <p className="project-tech">React, CSS, JavaScript</p>
                        <p>A responsive portfolio website built with React to showcase my skills and projects.</p>
                        <div className="project-links">
                            <a href="#" className="project-link">
                                View Project
                            </a>
                            <a href="#" className="project-link">
                                GitHub
                            </a>
                        </div>
                    </div>
                </div>

                <div className="project-card">
                    <div className="project-image placeholder"></div>
                    <div className="project-content">
                        <h2>Interactive Calculator</h2>
                        <p className="project-tech">React, CSS, JavaScript</p>
                        <p>A fully functional calculator app with a clean interface and error handling.</p>
                        <div className="project-links">
                            <a href="#" className="project-link">
                                View Project
                            </a>
                            <a href="#" className="project-link">
                                GitHub
                            </a>
                        </div>
                    </div>
                </div>

                <div className="project-card">
                    <div className="project-image placeholder"></div>
                    <div className="project-content">
                        <h2>E-commerce Platform</h2>
                        <p className="project-tech">React, Node.js, MongoDB</p>
                        <p>A full-stack e-commerce platform with user authentication, product catalog, and shopping cart.</p>
                        <div className="project-links">
                            <a href="#" className="project-link">
                                View Project
                            </a>
                            <a href="#" className="project-link">
                                GitHub
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Projects;

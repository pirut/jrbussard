import React from "react";
import { Link } from "react-router-dom";
import { person } from "../data/site";

export default function Footer() {
    const year = new Date().getFullYear();
    return (
        <footer className="footer">
            <div className="container">
                <div className="footer__inner">
                    <div className="footer__brand">
                        <b>JR Bussard</b>
                        <span>Operator by day, builder by night. {person.location}.</span>
                    </div>
                    <nav aria-label="Footer">
                        <ul className="footer__nav">
                            <li>
                                <Link to="/work">Work</Link>
                            </li>
                            <li>
                                <Link to="/notes">Notes</Link>
                            </li>
                            <li>
                                <Link to="/arcade">Arcade</Link>
                            </li>
                            <li>
                                <Link to="/about">About</Link>
                            </li>
                            <li>
                                <a href={person.github} target="_blank" rel="noreferrer">
                                    GitHub
                                </a>
                            </li>
                            <li>
                                <a href={person.linkedin} target="_blank" rel="noreferrer">
                                    LinkedIn
                                </a>
                            </li>
                        </ul>
                    </nav>
                </div>
                <div className="footer__meta">
                    <span>© {year} JR Bussard</span>
                    <span>
                        Prefer to walk? <Link to="/world">Enter the overworld</Link>
                    </span>
                </div>
            </div>
        </footer>
    );
}

import React from "react";
import { Link } from "react-router-dom";
import "../styles/NavBar.css";

const NavBar = () => {
    return (
        <nav className="navBar">
            <Link to="/" className="title suse">
                JR Bussard
            </Link>
            <ul>
                <li className="navElement">
                    <Link to="/">Home</Link>
                </li>
                <li className="navElement">
                    <Link to="/projects">Projects</Link>
                </li>
                <li className="navElement">
                    <Link to="/about">About Me</Link>
                </li>
                <li className="navElement">
                    <Link to="/contact">Contact</Link>
                </li>
                <li className="navElement">
                    <Link to="/calculator">Calculator</Link>
                </li>
            </ul>
        </nav>
    );
};

export default NavBar;

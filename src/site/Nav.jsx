import React, { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useScrolled, useTheme } from "./hooks";
import { Mark, Sun, Moon, Menu, Close } from "./Icons";
import { person } from "../data/site";

const LINKS = [
    { to: "/work", label: "Work" },
    { to: "/notes", label: "Notes" },
    { to: "/arcade", label: "Arcade" },
    { to: "/about", label: "About" },
];

export default function Nav() {
    const scrolled = useScrolled();
    const [theme, toggleTheme] = useTheme();
    const [open, setOpen] = useState(false);
    const { pathname } = useLocation();

    /* Close the menu on navigation, and keep the page from scrolling under it. */
    useEffect(() => setOpen(false), [pathname]);

    useEffect(() => {
        document.body.style.overflow = open ? "hidden" : "";
        return () => {
            document.body.style.overflow = "";
        };
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
            if (event.key === "Escape") setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    const themeLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

    return (
        <>
            <header className={`nav ${scrolled || open ? "is-scrolled" : ""}`}>
                <div className="container nav__inner">
                    <Link className="nav__brand" to="/" aria-label="JR Bussard, home">
                        <Mark className="nav__mark" />
                        <span>JR Bussard</span>
                    </Link>

                    <nav aria-label="Primary">
                        <ul className="nav__links">
                            {LINKS.map((link) => (
                                <li key={link.to}>
                                    <NavLink
                                        to={link.to}
                                        className={({ isActive }) =>
                                            `nav__link ${isActive ? "is-active" : ""}`
                                        }
                                    >
                                        {link.label}
                                    </NavLink>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    <div className="nav__right">
                        <button
                            type="button"
                            className="icon-btn"
                            onClick={toggleTheme}
                            aria-label={themeLabel}
                            title={themeLabel}
                        >
                            {theme === "dark" ? <Sun /> : <Moon />}
                        </button>
                        <a className="btn btn--primary nav__cta" href={`mailto:${person.email}`}>
                            Say hello
                        </a>
                        <button
                            type="button"
                            className="icon-btn nav__burger"
                            onClick={() => setOpen((v) => !v)}
                            aria-expanded={open}
                            aria-controls="mobile-menu"
                            aria-label={open ? "Close menu" : "Open menu"}
                        >
                            {open ? <Close /> : <Menu />}
                        </button>
                    </div>
                </div>
            </header>

            {open && (
                <div className="menu" id="mobile-menu">
                    <nav aria-label="Mobile">
                        <ul>
                            <li>
                                <NavLink to="/" end className={({ isActive }) => (isActive ? "is-active" : "")}>
                                    Home
                                </NavLink>
                            </li>
                            {LINKS.map((link) => (
                                <li key={link.to}>
                                    <NavLink
                                        to={link.to}
                                        className={({ isActive }) => (isActive ? "is-active" : "")}
                                    >
                                        {link.label}
                                    </NavLink>
                                </li>
                            ))}
                        </ul>
                    </nav>
                    <div className="menu__meta">
                        <a href={`mailto:${person.email}`}>Email</a>
                        <a href={person.github} target="_blank" rel="noreferrer">
                            GitHub
                        </a>
                        <a href={person.linkedin} target="_blank" rel="noreferrer">
                            LinkedIn
                        </a>
                    </div>
                </div>
            )}
        </>
    );
}

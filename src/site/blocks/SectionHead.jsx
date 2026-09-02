import React from "react";
import { Link } from "react-router-dom";
import Reveal from "../Reveal";

export default function SectionHead({ eyebrow, title, lede, to, cta, aside }) {
    return (
        <Reveal className="section__head">
            <div>
                {eyebrow && <p className="eyebrow">{eyebrow}</p>}
                <h2 className="display display--l">{title}</h2>
                {lede && <p className="lede">{lede}</p>}
            </div>
            {aside}
            {to && (
                <Link className="link" to={to}>
                    {cta} <span className="arrow">→</span>
                </Link>
            )}
        </Reveal>
    );
}

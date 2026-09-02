import React from "react";
import { Link } from "react-router-dom";
import Reveal from "../Reveal";

export default function CabinetCard({ app, index = 0, wide = false }) {
    return (
        <Reveal
            as={Link}
            to={app.route}
            index={index}
            className={`card cabinet ${wide ? "cabinet--wide" : ""}`}
            style={{ "--accent": app.accent, "--i": index }}
        >
            <div className="cabinet__screen" aria-hidden="true">
                <span className="cabinet__badge">{app.tags[0]}</span>
                <span className="cabinet__glyph">{app.glyph}</span>
            </div>
            <div className="cabinet__body">
                <h3 className="cabinet__name">{app.name}</h3>
                <p className="cabinet__blurb">{app.blurb}</p>
                <div className="cabinet__foot">
                    <span className="cabinet__play">Play →</span>
                    <span className="cabinet__tags">{app.tags.slice(1).join(" · ")}</span>
                </div>
            </div>
        </Reveal>
    );
}

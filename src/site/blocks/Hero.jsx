import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import NowCard from "./NowCard";
import { person } from "../../data/site";

const LINE_ONE = ["Operator", "by", "day,"];
const LINE_TWO = ["builder", "by", "night."];

function Words({ words, offset, emphasis }) {
    return words.map((word, i) => (
        <React.Fragment key={word}>
            <span className="word" style={{ "--i": offset + i }}>
                {emphasis === i ? <em>{word}</em> : word}
            </span>
            {i < words.length - 1 ? " " : null}
        </React.Fragment>
    ));
}

/* The glows follow the pointer a little. Fine pointers only, one rAF at a time. */
function useParallax() {
    useEffect(() => {
        if (!window.matchMedia("(pointer: fine)").matches) return undefined;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

        const root = document.documentElement;
        let frame = 0;
        let x = 0;
        let y = 0;

        const apply = () => {
            frame = 0;
            root.style.setProperty("--mx", x.toFixed(3));
            root.style.setProperty("--my", y.toFixed(3));
        };

        const onMove = (event) => {
            x = (event.clientX / window.innerWidth - 0.5) * 2;
            y = (event.clientY / window.innerHeight - 0.5) * 2;
            if (!frame) frame = window.requestAnimationFrame(apply);
        };

        window.addEventListener("pointermove", onMove, { passive: true });
        return () => {
            window.removeEventListener("pointermove", onMove);
            if (frame) window.cancelAnimationFrame(frame);
            root.style.removeProperty("--mx");
            root.style.removeProperty("--my");
        };
    }, []);
}

export default function Hero() {
    useParallax();

    return (
        <section className="hero" aria-labelledby="hero-title">
            <div className="hero__bg" aria-hidden="true">
                <div className="hero__panes" />
                <div className="hero__glow hero__glow--a" />
                <div className="hero__glow hero__glow--b" />
            </div>

            <div className="container hero__inner">
                <div>
                    <p className="eyebrow">
                        {person.name} · {person.location}
                    </p>
                    <h1 id="hero-title" className="display display--xl hero__title">
                        <Words words={LINE_ONE} offset={0} />
                        <br />
                        <Words words={LINE_TWO} offset={3} emphasis={0} />
                    </h1>
                    <p className="lede hero__lede">
                        I run operations at Cornerstone Companies, a South Florida impact window
                        and door company. When the house is quiet I build small, useful software:
                        apps my family uses, games my kids asked for, and notes on making
                        real-world systems run.
                    </p>
                    <div className="hero__actions">
                        <Link className="btn btn--primary" to="/work">
                            See the work <span className="arrow">→</span>
                        </Link>
                        <Link className="btn btn--ghost" to="/arcade">
                            Play the arcade
                        </Link>
                    </div>
                </div>

                <div className="hero__aside">
                    <NowCard />
                </div>
            </div>

            <div className="hero__scroll" aria-hidden="true">
                <span>Scroll</span>
                <i />
            </div>
        </section>
    );
}

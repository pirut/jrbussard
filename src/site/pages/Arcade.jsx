import React from "react";
import Reveal from "../Reveal";
import CabinetCard from "../blocks/CabinetCard";
import { usePageMeta } from "../hooks";
import { arcade, overworld } from "../../data/site";

export default function Arcade() {
    usePageMeta({
        title: "Arcade",
        description:
            "Small playable projects by JR Bussard: a 3D island, a multiplayer ASCII sandbox, an idle game, Snake, Breakout, and a toy for his kid.",
    });

    const [first, ...rest] = arcade;

    return (
        <>
            <header className="container page-head">
                <p className="eyebrow">The arcade</p>
                <h1 className="display display--xl">
                    Insert coin. <br />
                    <em>Everything</em> here is playable.
                </h1>
                <p className="lede">
                    Small projects that live inside this site rather than linking out. Some were
                    built for my kids, one runs on a real server, one is a whole island. Best
                    scores stay in your browser.
                </p>
            </header>

            <section className="section section--tight" aria-label="Cabinets">
                <div className="container">
                    <div className="cabinets">
                        <CabinetCard app={first} index={0} wide />
                        {rest.map((app, i) => (
                            <CabinetCard key={app.id} app={app} index={i + 1} />
                        ))}
                        <CabinetCard app={overworld} index={rest.length + 1} />
                    </div>
                </div>
            </section>

            <section className="section" aria-labelledby="controls-title">
                <div className="container">
                    <Reveal className="section__head">
                        <div>
                            <p className="eyebrow">Controls</p>
                            <h2 id="controls-title" className="display display--m">
                                Keyboard on a desk, thumbs on a phone.
                            </h2>
                        </div>
                    </Reveal>
                    <Reveal className="grid-2" index={1}>
                        {[first, ...rest, overworld].map((app) => (
                            <div className="card" key={app.id} style={{ padding: "1.2rem 1.4rem" }}>
                                <p className="eyebrow eyebrow--plain" style={{ marginBottom: "0.4rem" }}>
                                    {app.name}
                                </p>
                                <p className="muted" style={{ margin: 0 }}>
                                    {app.controls}
                                </p>
                            </div>
                        ))}
                    </Reveal>
                    <Reveal index={2} style={{ marginTop: "2rem" }}>
                        <ul className="keys">
                            <li>
                                <kbd>W</kbd>
                                <kbd>A</kbd>
                                <kbd>S</kbd>
                                <kbd>D</kbd> or arrows to move
                            </li>
                            <li>
                                <kbd>E</kbd> to act
                            </li>
                            <li>
                                <kbd>M</kbd> for the map
                            </li>
                            <li>
                                <kbd>Esc</kbd> closes anything
                            </li>
                        </ul>
                    </Reveal>
                </div>
            </section>
        </>
    );
}

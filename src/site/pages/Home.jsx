import React from "react";
import Hero from "../blocks/Hero";
import Ticker from "../blocks/Ticker";
import SectionHead from "../blocks/SectionHead";
import ProjectCard from "../blocks/ProjectCard";
import CabinetCard from "../blocks/CabinetCard";
import NoteCard, { NoteCardSkeleton } from "../blocks/NoteCard";
import GitHubFeed from "../blocks/GitHubFeed";
import ContactBand from "../blocks/ContactBand";
import { usePageMeta, useNotes } from "../hooks";
import { projects, arcade } from "../../data/site";

export default function Home() {
    usePageMeta({});
    const { notes, loading } = useNotes();

    return (
        <>
            <Hero />
            <Ticker />

            <section className="section" id="work" aria-labelledby="work-title">
                <div className="container">
                    <SectionHead
                        eyebrow="Selected work"
                        title="Things I run, and things I've built."
                        to="/work"
                        cta="All work"
                    />
                    <div className="work-grid">
                        {projects.map((project, i) => (
                            <ProjectCard key={project.id} project={project} feature={i === 0} index={i} />
                        ))}
                    </div>
                </div>
            </section>

            <section className="section" id="arcade" aria-labelledby="arcade-title">
                <div className="container">
                    <SectionHead
                        eyebrow="The arcade"
                        title="Small projects you can actually play."
                        lede="Not links out. Real pages hosted here, from a 3D island with proper suspension to a multiplayer field that persists."
                        to="/arcade"
                        cta="Every cabinet"
                    />
                    <div className="cabinets">
                        {arcade.slice(0, 4).map((app, i) => (
                            <CabinetCard key={app.id} app={app} index={i} />
                        ))}
                    </div>
                </div>
            </section>

            <section className="section" id="notes" aria-labelledby="notes-title">
                <div className="container">
                    <SectionHead
                        eyebrow="Notes"
                        title="What I've been thinking about."
                        to="/notes"
                        cta="All notes"
                    />
                    <div className="notes-grid">
                        {loading
                            ? Array.from({ length: 3 }, (unused, i) => <NoteCardSkeleton key={i} />)
                            : notes.slice(0, 3).map((note, i) => <NoteCard key={note.slug} note={note} index={i} />)}
                    </div>
                </div>
            </section>

            <section className="section" id="github" aria-labelledby="github-title">
                <div className="container">
                    <SectionHead
                        eyebrow="On GitHub"
                        title="What I've been pushing."
                        aside={
                            <span className="live">
                                <span className="live__dot" aria-hidden="true" />
                                Live from github.com/pirut
                            </span>
                        }
                    />
                    <GitHubFeed />
                </div>
            </section>

            <ContactBand />
        </>
    );
}

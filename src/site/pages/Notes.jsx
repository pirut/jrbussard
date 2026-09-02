import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Reveal from "../Reveal";
import { usePageMeta, useNotes } from "../hooks";
import { formatDate } from "../../lib/format";

function RowSkeleton() {
    return (
        <li className="note-row" aria-hidden="true">
            <span className="skeleton" style={{ height: "0.8rem", width: "70%" }} />
            <div>
                <span className="skeleton" style={{ display: "block", height: "1.6rem", width: "60%" }} />
                <span
                    className="skeleton"
                    style={{ display: "block", height: "1rem", width: "90%", marginTop: "0.6rem" }}
                />
            </div>
            <span className="skeleton" style={{ height: "1.2rem", width: "4rem" }} />
        </li>
    );
}

export default function Notes() {
    usePageMeta({
        title: "Notes",
        description: "Short notes by JR Bussard on operations, building small tools, and the web.",
    });

    const { notes, loading } = useNotes();
    const [category, setCategory] = useState("All");

    const categories = useMemo(() => {
        const set = new Set(notes.map((note) => note.category));
        return ["All", ...Array.from(set)];
    }, [notes]);

    const visible = category === "All" ? notes : notes.filter((note) => note.category === category);

    return (
        <>
            <header className="container page-head">
                <p className="eyebrow">Notes</p>
                <h1 className="display display--xl">
                    Short notes, <br />
                    <em>written</em> to be read.
                </h1>
                <p className="lede">
                    On operations, on building small tools, and on keeping a personal site light
                    enough that it actually gets updated.
                </p>
            </header>

            <section className="section section--tight" aria-label="All notes">
                <div className="container">
                    {categories.length > 2 && (
                        <div className="filters" role="group" aria-label="Filter by category">
                            {categories.map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    className={`chip ${item === category ? "is-active" : ""}`}
                                    onClick={() => setCategory(item)}
                                    aria-pressed={item === category}
                                >
                                    {item}
                                </button>
                            ))}
                        </div>
                    )}

                    <ul className="notes-list">
                        {loading
                            ? Array.from({ length: 3 }, (unused, i) => <RowSkeleton key={i} />)
                            : visible.map((note, i) => (
                                  <Reveal as="li" key={note.slug} index={Math.min(i, 6)}>
                                      <Link className="note-row" to={`/notes/${note.slug}`}>
                                          <time dateTime={note.date}>{formatDate(note.date)}</time>
                                          <div>
                                              <h3>{note.title}</h3>
                                              <p>{note.summary}</p>
                                          </div>
                                          <span className="tag">{note.category}</span>
                                      </Link>
                                  </Reveal>
                              ))}
                    </ul>

                    {!loading && !visible.length && (
                        <p className="muted" style={{ marginTop: "2rem" }}>
                            Nothing in this category yet.
                        </p>
                    )}
                </div>
            </section>
        </>
    );
}

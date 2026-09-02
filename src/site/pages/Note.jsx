import React, { Suspense, lazy } from "react";
import { Link, useParams } from "react-router-dom";
import Loading from "../Loading";
import { usePageMeta, useNotes } from "../hooks";
import { formatDate, readingTime } from "../../lib/format";

const Markdown = lazy(() => import("../blocks/Markdown"));

function Missing() {
    usePageMeta({ title: "Note not found" });
    return (
        <div className="container container--narrow lost">
            <div>
                <p className="lost__code">404</p>
                <h1 className="display display--l">That note isn't on the shelf.</h1>
                <p className="lede" style={{ marginInline: "auto" }}>
                    It may have been unpublished, or the link is a little off.
                </p>
                <p style={{ marginTop: "2rem" }}>
                    <Link className="btn btn--primary" to="/notes">
                        All notes
                    </Link>
                </p>
            </div>
        </div>
    );
}

function Article({ note, previous, next }) {
    usePageMeta({ title: note.title, description: note.summary });

    return (
        <article className="container container--narrow article">
            <header className="article__head">
                <p className="eyebrow">
                    <Link to="/notes" style={{ textDecoration: "none", color: "inherit" }}>
                        Notes
                    </Link>
                </p>
                <h1 className="display display--l">{note.title}</h1>
                {note.summary && <p className="lede">{note.summary}</p>}
                <div className="article__meta">
                    <span>
                        <b>{note.category}</b>
                    </span>
                    <time dateTime={note.date}>{formatDate(note.date)}</time>
                    <span>{readingTime(note.body)} min read</span>
                </div>
            </header>

            <div className="prose">
                <Suspense fallback={<Loading />}>
                    <Markdown>{note.body}</Markdown>
                </Suspense>
            </div>

            {(previous || next) && (
                <nav className="article__pager" aria-label="More notes">
                    {previous ? (
                        <Link className="card" to={`/notes/${previous.slug}`}>
                            <small>Newer</small>
                            <span>{previous.title}</span>
                        </Link>
                    ) : (
                        <span />
                    )}
                    {next && (
                        <Link className="card" to={`/notes/${next.slug}`}>
                            <small>Older</small>
                            <span>{next.title}</span>
                        </Link>
                    )}
                </nav>
            )}
        </article>
    );
}

export default function Note() {
    const { slug } = useParams();
    const { notes, loading } = useNotes();

    if (loading) return <Loading />;

    const index = notes.findIndex((note) => note.slug === slug);
    if (index === -1) return <Missing />;

    return (
        <Article
            key={slug}
            note={notes[index]}
            previous={index > 0 ? notes[index - 1] : null}
            next={index < notes.length - 1 ? notes[index + 1] : null}
        />
    );
}

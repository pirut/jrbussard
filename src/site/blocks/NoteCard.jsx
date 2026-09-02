import React from "react";
import { Link } from "react-router-dom";
import Reveal from "../Reveal";
import { formatDate } from "../../lib/format";

export default function NoteCard({ note, index = 0 }) {
    return (
        <Reveal as={Link} to={`/notes/${note.slug}`} index={index} className="card note-card">
            <div className="note-card__meta">
                <b>{note.category}</b>
                <time dateTime={note.date}>{formatDate(note.date)}</time>
            </div>
            <h3 className="note-card__title">{note.title}</h3>
            <p className="note-card__summary">{note.summary}</p>
            <span className="note-card__read">Read the note →</span>
        </Reveal>
    );
}

export function NoteCardSkeleton() {
    return (
        <div className="card note-card" aria-hidden="true">
            <span className="skeleton" style={{ height: "0.8rem", width: "40%" }} />
            <span className="skeleton" style={{ height: "1.6rem", width: "90%" }} />
            <span className="skeleton" style={{ height: "1rem", width: "100%" }} />
            <span className="skeleton" style={{ height: "1rem", width: "75%" }} />
        </div>
    );
}

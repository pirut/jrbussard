import React from "react";
import { useGitHub } from "../../hooks/useGitHub";
import { useClock, useSpotlight } from "../hooks";
import { timeAgo } from "../../lib/format";
import { now, person } from "../../data/site";

export default function NowCard() {
    const { activity, loading } = useGitHub();
    const time = useClock(person.timeZone);
    const spotlight = useSpotlight();
    const latest = activity[0];

    return (
        <aside className="card spot now" onPointerMove={spotlight} aria-label="Right now">
            <div className="now__head">
                <p className="eyebrow eyebrow--plain">Right now</p>
                {time && (
                    <span className="now__clock" title={`Local time in ${person.location}`}>
                        {time} · WPB
                    </span>
                )}
            </div>
            <dl className="now__rows">
                <div className="now__row">
                    <dt>Role</dt>
                    <dd>
                        <a href={now.role.href} target="_blank" rel="noreferrer">
                            {now.role.label}
                        </a>
                    </dd>
                </div>
                <div className="now__row">
                    <dt>Building</dt>
                    <dd>
                        <a href={now.building.href} target="_blank" rel="noreferrer">
                            {now.building.label}
                        </a>
                        <small>{now.building.note}</small>
                    </dd>
                </div>
                <div className="now__row">
                    <dt>Last push</dt>
                    <dd>
                        {latest ? (
                            <>
                                <a href={latest.url} target="_blank" rel="noreferrer">
                                    {latest.message}
                                </a>
                                <small>
                                    {latest.repo} · {timeAgo(latest.date)}
                                </small>
                            </>
                        ) : loading ? (
                            <span className="skeleton" style={{ display: "block", height: "1.1em", width: "70%" }} />
                        ) : (
                            <span className="faint">GitHub is quiet right now</span>
                        )}
                    </dd>
                </div>
                <div className="now__row">
                    <dt>Status</dt>
                    <dd>
                        <span className="status">
                            <span className="status__dot" aria-hidden="true" />
                            {now.availability}
                        </span>
                    </dd>
                </div>
            </dl>
        </aside>
    );
}

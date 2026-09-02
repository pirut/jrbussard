import React from "react";
import Reveal from "../Reveal";
import { useGitHub } from "../../hooks/useGitHub";
import { timeAgo } from "../../lib/format";
import { ArrowUpRight, Star } from "../Icons";
import { person } from "../../data/site";

const LANGUAGE_COLORS = {
    JavaScript: "#f1e05a",
    TypeScript: "#3178c6",
    HTML: "#e34c26",
    CSS: "#663399",
    Python: "#3572a5",
    Go: "#00add8",
    Rust: "#dea584",
    Shell: "#89e051",
    Swift: "#f05138",
    Kotlin: "#a97bff",
};

function RepoSkeleton() {
    return (
        <li className="repo" aria-hidden="true">
            <span className="skeleton" style={{ height: "1rem", width: "50%" }} />
            <span className="skeleton" style={{ height: "0.85rem", width: "95%" }} />
            <span className="skeleton" style={{ height: "0.85rem", width: "60%" }} />
        </li>
    );
}

function CommitSkeleton() {
    return (
        <li className="commit" aria-hidden="true">
            <span className="commit__line" />
            <div>
                <span className="skeleton" style={{ display: "block", height: "0.9rem", width: "85%" }} />
                <span
                    className="skeleton"
                    style={{ display: "block", height: "0.7rem", width: "40%", marginTop: "0.4rem" }}
                />
            </div>
        </li>
    );
}

export default function GitHubFeed() {
    const { repos, activity, loading, error } = useGitHub();
    const topRepos = repos.slice(0, 6);
    const commits = activity.slice(0, 8);

    return (
        <div className="gh">
            <Reveal className="card gh__panel">
                <h3>Repositories</h3>
                {error && !repos.length ? (
                    <p className="gh__empty">
                        GitHub is not answering right now.{" "}
                        <a className="link" href={person.github} target="_blank" rel="noreferrer">
                            Browse directly <ArrowUpRight />
                        </a>
                    </p>
                ) : (
                    <ul className="repos">
                        {loading && !repos.length
                            ? Array.from({ length: 4 }, (unused, i) => <RepoSkeleton key={i} />)
                            : topRepos.map((repo) => (
                                  <li key={repo.id}>
                                      <a className="repo" href={repo.url} target="_blank" rel="noreferrer">
                                          <span className="repo__name">
                                              {repo.name}
                                              <ArrowUpRight />
                                          </span>
                                          <p className="repo__desc">
                                              {repo.description || "No description yet."}
                                          </p>
                                          <span className="repo__meta">
                                              {repo.language && (
                                                  <span
                                                      className="lang"
                                                      style={{ "--lang": LANGUAGE_COLORS[repo.language] }}
                                                  >
                                                      <i aria-hidden="true" />
                                                      {repo.language}
                                                  </span>
                                              )}
                                              {repo.stars > 0 && (
                                                  <span className="lang">
                                                      <Star /> {repo.stars}
                                                  </span>
                                              )}
                                              <span>pushed {timeAgo(repo.pushed)}</span>
                                          </span>
                                      </a>
                                  </li>
                              ))}
                    </ul>
                )}
            </Reveal>

            <Reveal className="card gh__panel" index={1}>
                <h3>Recent commits</h3>
                {!loading && !commits.length ? (
                    <p className="gh__empty">Nothing pushed recently.</p>
                ) : (
                    <ul className="commits">
                        {loading && !commits.length
                            ? Array.from({ length: 5 }, (unused, i) => <CommitSkeleton key={i} />)
                            : commits.map((commit) => (
                                  <li key={commit.sha}>
                                      <a className="commit" href={commit.url} target="_blank" rel="noreferrer">
                                          <span className="commit__line" aria-hidden="true" />
                                          <span>
                                              <p className="commit__msg">{commit.message}</p>
                                              <span className="commit__meta">
                                                  <b>{commit.repo}</b>
                                                  <span>{timeAgo(commit.date)}</span>
                                              </span>
                                          </span>
                                      </a>
                                  </li>
                              ))}
                    </ul>
                )}
            </Reveal>
        </div>
    );
}

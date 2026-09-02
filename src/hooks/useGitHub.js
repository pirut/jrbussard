import { useState, useEffect } from "react";
import { featuredRepos } from "../data/site";

const GITHUB_USER = "pirut";
const CACHE_KEY = "gh_cache_v4";
const CACHE_TTL = 5 * 60 * 1000;

/*
 * Pinned repositories come first in the order they are listed, then
 * everything else by most recent push. Forks and empty repositories never
 * take a slot.
 */
function curate(repos) {
    const rank = new Map(featuredRepos.map((name, i) => [name.toLowerCase(), i]));
    const rankOf = (repo) =>
        rank.has(repo.name.toLowerCase()) ? rank.get(repo.name.toLowerCase()) : Infinity;
    return repos
        .filter((repo) => !repo.fork && !repo.archived && repo.size > 0)
        .sort((a, b) => {
            const ra = rankOf(a);
            const rb = rankOf(b);
            if (ra !== rb) return ra - rb;
            return new Date(b.pushed_at) - new Date(a.pushed_at);
        })
        .map((repo) => ({
            id: repo.id,
            name: repo.name,
            description: repo.description || "",
            url: repo.html_url,
            language: repo.language || "",
            stars: repo.stargazers_count || 0,
            pushed: repo.pushed_at,
        }));
}

function getCached() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts > CACHE_TTL) return null;
        return parsed;
    } catch {
        return null;
    }
}

function setCache(data) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, ts: Date.now() }));
    } catch {
        /* quota exceeded or private mode */
    }
}

async function fetchAll() {
    const reposRes = await fetch(
        `https://api.github.com/users/${GITHUB_USER}/repos?sort=pushed&per_page=100`
    );
    if (!reposRes.ok) throw new Error(`GitHub responded ${reposRes.status}`);
    const repos = curate(await reposRes.json());

    /* Recent commits from the most active few. */
    const commitResults = await Promise.all(
        repos.slice(0, 4).map((repo) =>
            fetch(`https://api.github.com/repos/${GITHUB_USER}/${repo.name}/commits?per_page=6`)
                .then((r) => (r.ok ? r.json() : []))
                .then((commits) =>
                    Array.isArray(commits)
                        ? commits.map((c) => ({
                              sha: c.sha,
                              message: c.commit?.message?.split("\n")[0] || "",
                              date: c.commit?.author?.date || "",
                              repo: repo.name,
                              url: c.html_url,
                          }))
                        : []
                )
                .catch(() => [])
        )
    );

    const activity = commitResults
        .flat()
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 12);

    return { repos, activity };
}

/* One request per page load, however many components ask. */
let inflight = null;

function load() {
    const cached = getCached();
    if (cached) return Promise.resolve(cached);
    if (!inflight) {
        inflight = fetchAll().then((data) => {
            setCache(data);
            return data;
        });
        inflight.catch(() => {
            inflight = null;
        });
    }
    return inflight;
}

export function useGitHub() {
    const [state, setState] = useState(() => {
        const cached = getCached();
        return cached
            ? { repos: cached.repos || [], activity: cached.activity || [], loading: false, error: null }
            : { repos: [], activity: [], loading: true, error: null };
    });

    useEffect(() => {
        if (!state.loading) return undefined;
        let cancelled = false;
        load()
            .then((data) => {
                if (!cancelled) {
                    setState({ repos: data.repos || [], activity: data.activity || [], loading: false, error: null });
                }
            })
            .catch((error) => {
                if (!cancelled) setState((s) => ({ ...s, loading: false, error: error.message }));
            });
        return () => {
            cancelled = true;
        };
    }, [state.loading]);

    return state;
}

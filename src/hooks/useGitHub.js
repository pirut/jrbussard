import { useState, useEffect } from "react";

const GITHUB_USER = "pirut";
const CACHE_KEY = "gh_cache_v2";
const CACHE_TTL = 5 * 60 * 1000;

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
        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({ ...data, ts: Date.now() })
        );
    } catch {
        /* quota exceeded */
    }
}

export function useGitHub() {
    const [repos, setRepos] = useState([]);
    const [activity, setActivity] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const cached = getCached();
        if (cached) {
            setRepos(cached.repos || []);
            setActivity(cached.activity || []);
            setLoading(false);
            return;
        }

        let cancelled = false;

        async function fetchData() {
            try {
                /* 1. Fetch repos sorted by most recent push */
                const reposRes = await fetch(
                    `https://api.github.com/users/${GITHUB_USER}/repos?sort=pushed&per_page=8`
                );
                if (!reposRes.ok) throw new Error("GitHub API error");
                const reposData = await reposRes.json();

                /* 2. Fetch recent commits from the top 4 active repos */
                const topRepos = reposData.slice(0, 4);
                const commitResults = await Promise.all(
                    topRepos.map((repo) =>
                        fetch(
                            `https://api.github.com/repos/${GITHUB_USER}/${repo.name}/commits?per_page=5`
                        )
                            .then((r) => (r.ok ? r.json() : []))
                            .then((commits) =>
                                Array.isArray(commits)
                                    ? commits.map((c) => ({
                                          sha: c.sha,
                                          message:
                                              c.commit?.message
                                                  ?.split("\n")[0] || "",
                                          date: c.commit?.author?.date || "",
                                          repo: repo.name,
                                          url: c.html_url,
                                          author:
                                              c.commit?.author?.name || "",
                                      }))
                                    : []
                            )
                            .catch(() => [])
                    )
                );

                /* 3. Merge and sort by date, newest first */
                const allActivity = commitResults
                    .flat()
                    .sort(
                        (a, b) =>
                            new Date(b.date).getTime() -
                            new Date(a.date).getTime()
                    )
                    .slice(0, 15);

                if (!cancelled) {
                    setRepos(reposData);
                    setActivity(allActivity);
                    setCache({
                        repos: reposData,
                        activity: allActivity,
                    });
                }
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        fetchData();
        return () => {
            cancelled = true;
        };
    }, []);

    return { repos, activity, loading, error };
}

import { useCallback, useEffect, useState } from "react";
import { fetchNotes } from "../lib/sanity";

const SITE_TITLE = "JR Bussard";
const DEFAULT_TITLE = "JR Bussard — operator by day, builder by night";
const ORIGIN = "https://www.jrbussard.com";

/* Title, description and canonical for the current page. */
export function usePageMeta({ title, description } = {}) {
    useEffect(() => {
        document.title = title ? `${title} — ${SITE_TITLE}` : DEFAULT_TITLE;

        if (description) {
            const meta = document.querySelector('meta[name="description"]');
            if (meta) meta.setAttribute("content", description);
        }

        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) {
            const path = window.location.pathname === "/" ? "/" : window.location.pathname.replace(/\/$/, "");
            canonical.setAttribute("href", `${ORIGIN}${path}`);
        }
    }, [title, description]);
}

/* Light or dark, remembered per browser. The inline script in index.html
   already chose one before first paint; this just keeps it in sync. */
export function useTheme() {
    const [theme, setTheme] = useState(() =>
        typeof document === "undefined"
            ? "dark"
            : document.documentElement.getAttribute("data-theme") || "dark"
    );

    const toggle = useCallback(() => {
        setTheme((current) => {
            const next = current === "dark" ? "light" : "dark";
            document.documentElement.setAttribute("data-theme", next);
            try {
                localStorage.setItem("theme", next);
            } catch {
                /* private mode */
            }
            return next;
        });
    }, []);

    return [theme, toggle];
}

/* Notes from the CMS, shared across every component that asks. */
export function useNotes() {
    const [state, setState] = useState({ notes: [], loading: true });

    useEffect(() => {
        let mounted = true;
        fetchNotes().then((notes) => {
            if (mounted) setState({ notes, loading: false });
        });
        return () => {
            mounted = false;
        };
    }, []);

    return state;
}

/* Wall clock in a given time zone, ticking once a minute. */
export function useClock(timeZone) {
    const read = useCallback(() => {
        try {
            return new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone,
            }).format(new Date());
        } catch {
            return "";
        }
    }, [timeZone]);

    const [time, setTime] = useState(read);

    useEffect(() => {
        setTime(read());
        const align = 60000 - (Date.now() % 60000);
        let interval;
        const timeout = setTimeout(() => {
            setTime(read());
            interval = setInterval(() => setTime(read()), 60000);
        }, align);
        return () => {
            clearTimeout(timeout);
            if (interval) clearInterval(interval);
        };
    }, [read]);

    return time;
}

/* Writes the pointer position into a card so CSS can draw a spotlight. */
export function useSpotlight() {
    return useCallback((event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--x", `${event.clientX - rect.left}px`);
        event.currentTarget.style.setProperty("--y", `${event.clientY - rect.top}px`);
    }, []);
}

/* True once the user has scrolled past a threshold. */
export function useScrolled(threshold = 12) {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        let ticking = false;
        const update = () => {
            setScrolled(window.scrollY > threshold);
            ticking = false;
        };
        const onScroll = () => {
            if (!ticking) {
                ticking = true;
                window.requestAnimationFrame(update);
            }
        };
        update();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, [threshold]);

    return scrolled;
}

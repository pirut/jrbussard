/* Everything the site says about its owner, in one place. */

export const person = {
    name: "JR Bussard",
    role: "Chief Operating Officer",
    company: "Cornerstone Companies",
    companyUrl: "https://cstonefl.com",
    location: "West Palm Beach, Florida",
    timeZone: "America/New_York",
    email: "scottbussardjr@gmail.com",
    github: "https://github.com/pirut",
    linkedin: "https://www.linkedin.com/in/jr-bussard-0937bb122/",
    site: "https://www.jrbussard.com",
};

export const projects = [
    {
        id: "cornerstone",
        name: "Cornerstone Companies",
        role: "COO",
        since: "2021",
        status: "running",
        tagline: "Make the real world run.",
        description:
            "Operating the people, systems, and day-to-day work behind a South Florida impact window and door company. Scheduling, installs, service, warranty, and the software that holds it together.",
        highlights: [
            "Own operations end to end: crews, scheduling, permits, service.",
            "Built the internal tooling that replaced the spreadsheet sprawl.",
            "The work is mostly removing friction nobody had time to name.",
        ],
        tags: ["Operations", "People", "Systems"],
        links: [{ label: "cstonefl.com", href: "https://cstonefl.com" }],
    },
    {
        id: "meltdown",
        name: "Meltdown",
        role: "Side project",
        since: "2025",
        status: "running",
        tagline: "Turn chaos into a story.",
        description:
            "A small social app for the funny, inexplicable reasons kids have a meltdown. Post one, read the rest, feel less alone at 6pm on a Tuesday.",
        highlights: [
            "One-thumb posting: the whole flow is a title and a shrug.",
            "Built in a weekend, kept alive because my family uses it.",
        ],
        tags: ["React", "Supabase", "Social"],
        links: [{ label: "meltdown.jrbussard.com", href: "https://meltdown.jrbussard.com" }],
    },
    {
        id: "waves",
        name: "Make Waves",
        role: "Side project",
        since: "2025",
        status: "in progress",
        tagline: "Turn energy into action.",
        description:
            "A lightweight platform for turning community energy into organized action: events, sign-ups, and the follow-through that usually gets lost.",
        highlights: [
            "Events, RSVPs, and reminders without a committee.",
            "The hard part is follow-through, so that is what it optimises for.",
        ],
        tags: ["Next.js", "Postgres", "Events"],
        links: [{ label: "waves.jrbussard.com", href: "https://waves.jrbussard.com" }],
    },
];

/* What the "Now" card on the front page says. */
export const now = {
    role: { label: "COO, Cornerstone Companies", href: "https://cstonefl.com" },
    building: { label: "Make Waves", href: "https://waves.jrbussard.com", note: "in progress" },
    availability: "Open to interesting problems",
};

/* Three things the work keeps teaching. Shown on /work. */
export const principles = [
    {
        title: "Small tools usually win.",
        body: "The best internal tools are boring. They save a few clicks, remove a little confusion, or make a repeated task easier to finish. Platforms come later, if ever.",
    },
    {
        title: "Operations is a systems problem.",
        body: "If the path is unclear, people invent their own paths. Clear handoffs and fewer loose ends fix more than any amount of urgency does.",
    },
    {
        title: "Follow-through is the product.",
        body: "Ideas are cheap and everyone has energy on day one. What people actually need is the thing that makes the next step happen.",
    },
];

/* Scrolls under the hero. */
export const stack = [
    "Operations",
    "Scheduling",
    "Permits & installs",
    "Internal tools",
    "React",
    "Vite",
    "Next.js",
    "Postgres",
    "Supabase",
    "Convex",
    "Three.js",
    "Sanity",
    "Vercel",
    "West Palm Beach",
];

/*
 * Repositories to pin to the front of the GitHub feed, in this order.
 * Anything not named here fills the remaining slots by most recent push.
 */
export const featuredRepos = ["jrbussard", "meltdown", "makewaves"];

/* Arcade cabinets are the hosted small projects, registered once in
   microfrontends/registry.jsx so a route and a cabinet never drift apart. */
export { microfrontends as arcade } from "../microfrontends/registry";

/* The previous version of this site, kept playable. */
export const overworld = {
    id: "overworld",
    name: "The Overworld",
    route: "/world",
    blurb:
        "The last version of this site was a walkable ASCII map: a library of notes, a foundry of projects, an observatory of live commits, and an arcade. It still is. Walk in.",
    tags: ["ASCII", "Explorable", "Previous site"],
    accent: "#e8c37a",
    glyph: "@",
    controls: "WASD to walk, E to act, M for the map",
};

export const about = {
    title: "THE OPERATOR",
    /* Read in full on /about. The first paragraph is the big one. */
    bio: [
        "I run a real-world company by day and build small software when the house is quiet.",
        "By day I am the COO of Cornerstone Companies, an impact window and door company in South Florida. That means crews, scheduling, permits, installs, service, warranty, and the software that keeps all of it pointed in the same direction. Most of the job is removing friction nobody had time to name.",
        "By night I build small things: tools that replace a spreadsheet, an app my family actually uses, games my kids asked for. I like tools that do one job clearly, and systems with fewer loose ends.",
        "This site is a workshop, not a resume. The work is what I run and what I have built, the notes are what I have been thinking about, the GitHub feed is live, and the arcade is where the small things live.",
    ],
    facts: [
        { label: "Based in", value: "West Palm Beach, FL" },
        { label: "Day job", value: "COO, Cornerstone Companies" },
        { label: "Building", value: "Make Waves, Meltdown" },
        { label: "Kids", value: "Two, both consultants on the arcade" },
    ],
    /* Still read aloud by the statue in the overworld. */
    lines: [
        "JR Bussard. West Palm Beach, Florida.",
        "",
        "COO by day: people, process, and the unglamorous systems that keep a",
        "real-world company moving. Builder by night: small tools, small apps,",
        "and whatever my kids talk me into.",
        "",
        "This site is a workshop, not a resume. Wander around. The Library holds",
        "what I have been thinking about, the Foundry holds what I have built,",
        "the Observatory is a live feed from GitHub, and the Arcade is where I",
        "park the small things.",
    ],
    links: [
        { label: "GitHub", href: "https://github.com/pirut" },
        { label: "LinkedIn", href: "https://www.linkedin.com/in/jr-bussard-0937bb122/" },
    ],
};

export const colophon = [
    { label: "Type", value: "Fraunces and Work Sans, self-hosted" },
    { label: "Site", value: "React and Vite, static, on Vercel" },
    { label: "Notes", value: "Sanity, fetched at read time" },
    { label: "Commons", value: "Convex, server-authoritative" },
    { label: "Adventure Bay", value: "Three.js, every asset generated" },
    { label: "Source", value: "github.com/pirut/jrbussard" },
];

export const contact = {
    title: "THE BEACON",
    email: "scottbussardjr@gmail.com",
    lines: [
        "Light the beacon and I will see it.",
        "",
        "Good for: interesting problems, operations questions, small builds,",
        "or telling me something on this map is broken.",
    ],
};

/* Signposts inside the overworld, keyed by room id then marker index. */
export const signs = {
    atrium: [
        {
            title: "HOW TO MOVE",
            lines: [
                "  W A S D  or arrow keys      walk",
                "  E / ENTER / SPACE           interact with what you are beside",
                "  M                           open the world map",
                "  ESC                         close whatever is open",
                "",
                "On a phone: use the pad in the corner. The round button acts.",
                "",
                "Props glow when they are worth touching, and go cold when there",
                "is nothing behind them. Stand next to one and the bar at the",
                "bottom will tell you what it is.",
                "",
                "Four roads leave this crossing:",
                "",
                "  north   THE OBSERVATORY    what I have been pushing",
                "  west    THE LIBRARY        what I have been thinking",
                "  east    THE FOUNDRY        what I build and run",
                "  south   THE ARCADE        then THE BEACON, at the water",
            ],
        },
    ],
    library: [
        {
            title: "ABOUT THIS ROOM",
            lines: [
                "Every book on these shelves is a note I have written. The",
                "newest sits top-left; they run down and to the right, and the",
                "empty slots are shelf space I have not filled yet.",
                "",
                "Notes are published from a CMS, so the shelves restock",
                "themselves whenever I write something — no deploy needed.",
                "",
                "The card catalog by the hearth lists everything at once if you",
                "would rather not walk the stacks.",
            ],
        },
    ],
    arcade: [
        {
            title: "THE ARCADE RULES",
            lines: [
                "Cabinets are small projects that live inside this site — not",
                "links out, actual pages hosted here.",
                "",
                "Step up to a lit one and press the action key to play it. Dark",
                "cabinets are open slots waiting on the next idea.",
                "",
                "Every cabinet is one entry in the code. Adding a project lights",
                "the next slot on its own.",
            ],
        },
    ],
};

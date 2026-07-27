/* Everything the world can show you, keyed to the props you walk up to. */

export const projects = [
    {
        id: "cornerstone",
        name: "CORNERSTONE COMPANIES",
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
        name: "MELTDOWN",
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
        links: [
            { label: "meltdown.jrbussard.com", href: "https://meltdown.jrbussard.com" },
        ],
    },
    {
        id: "waves",
        name: "MAKE WAVES",
        role: "Side project",
        since: "2025",
        status: "in progress",
        tagline: "Turn energy into action.",
        description:
            "A lightweight platform for turning community energy into organized action — events, sign-ups, and the follow-through that usually gets lost.",
        highlights: [
            "Events, RSVPs, and reminders without a committee.",
            "The hard part is follow-through, so that is what it optimises for.",
        ],
        tags: ["Next.js", "Postgres", "Events"],
        links: [{ label: "waves.jrbussard.com", href: "https://waves.jrbussard.com" }],
    },
];

/*
 * Repositories to pin to the front of the Observatory, in this order. Anything
 * not named here fills the remaining stars by most recent push. Keeps the sky
 * from being whatever GitHub happened to return first.
 */
export const featuredRepos = ["jrbussard", "meltdown", "makewaves"];

/* Arcade cabinets are the hosted small projects, registered once in
   microfrontends/registry.js so a route and a cabinet never drift apart. */
export { microfrontends as arcade } from "../microfrontends/registry";

export const about = {
    title: "THE OPERATOR",
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
        {
            label: "LinkedIn",
            href: "https://www.linkedin.com/in/jr-bussard-0937bb122/",
        },
    ],
};

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

/* Signposts, keyed by room id then by the marker's index within that room. */
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

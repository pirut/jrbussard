/* Everything the world can show you, keyed to the props you walk up to. */

export const projects = [
    {
        id: "cornerstone",
        name: "CORNERSTONE COMPANIES",
        role: "COO",
        tagline: "Make the real world run.",
        description:
            "Operating the people, systems, and day-to-day work behind a South Florida impact window and door company. Scheduling, installs, service, and the software that holds it together.",
        tags: ["Operations", "People", "Systems"],
        href: "https://cstonefl.com",
    },
    {
        id: "meltdown",
        name: "MELTDOWN",
        role: "Side project",
        tagline: "Turn chaos into a story.",
        description:
            "A small social app for the funny, inexplicable reasons kids have a meltdown. Post one, read the rest, feel less alone at 6pm on a Tuesday.",
        tags: ["React", "Supabase", "Social"],
        href: "https://meltdown.jrbussard.com",
    },
    {
        id: "waves",
        name: "MAKE WAVES",
        role: "Side project",
        tagline: "Turn energy into action.",
        description:
            "A lightweight platform for turning community energy into organized action — events, sign-ups, and the follow-through that usually gets lost.",
        tags: ["Next.js", "Postgres", "Events"],
        href: "https://waves.jrbussard.com",
    },
];

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
                "  M                           open the map",
                "  ESC                         close whatever is open",
                "",
                "On a phone: use the pad in the corner. The round button acts.",
                "",
                "Props glow when they are worth touching. Stand next to one and",
                "the bar at the bottom will tell you what it is.",
            ],
        },
    ],
    library: [
        {
            title: "THE CARD CATALOG",
            lines: [
                "Every book on these shelves is a note I have written.",
                "The newest sits top-left; they run down and to the right.",
                "",
                "Books are published from a CMS, so the shelves restock",
                "themselves whenever I write something.",
            ],
        },
    ],
    arcade: [
        {
            title: "THE ARCADE RULES",
            lines: [
                "Cabinets are small projects that live inside this site.",
                "Step up to a lit one and press the action key to play it.",
                "",
                "Dark cabinets are empty slots waiting on the next idea.",
            ],
        },
    ],
};

/*
 * The part of the day it is where the visitor is sitting, unless the URL pins
 * one (?phase=night), as the Commons allows. Kept free of Three.js so the HUD
 * can name the hour before the scene has loaded.
 *
 * Deliberately client-only and local: the site's sky follows the visitor's
 * own wall clock, not the Commons' shared day cycle
 * (src/lib/game/daycycle.js), so nothing here has to agree with convex or
 * src/lib. PHASE_NAMES must stay equal to the keys of PHASES in
 * arcade/ascii3d/AsciiWorld.js, because SiteScene looks the result up there
 * (and silently falls back to "dusk" for a name it does not know). Called
 * once per mount of pages/World.js (a useMemo with no dependencies), so a
 * visit keeps one sky rather than re-lighting the city as the hour turns.
 */
export const PHASE_NAMES = ["dawn", "day", "dusk", "night"];

/*
 * `now` is a Date (injectable for tests) read in local time; `search` is a
 * location.search string. A ?phase= value that is not in PHASE_NAMES is
 * ignored rather than trusted. Hour bands, local time: dawn 05-08, day
 * 08-17, dusk 17-20, night otherwise (20-05). Returns one of PHASE_NAMES.
 */
export function localPhase(now = new Date(), search = "") {
    const pinned = new URLSearchParams(search).get("phase");
    if (PHASE_NAMES.includes(pinned)) return pinned;
    const h = now.getHours();
    if (h >= 5 && h < 8) return "dawn";
    if (h >= 8 && h < 17) return "day";
    if (h >= 17 && h < 20) return "dusk";
    return "night";
}

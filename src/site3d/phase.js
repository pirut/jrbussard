/*
 * The part of the day it is where the visitor is sitting, unless the URL pins
 * one (?phase=night), as the Commons allows. Kept free of Three.js so the HUD
 * can name the hour before the scene has loaded.
 */
export const PHASE_NAMES = ["dawn", "day", "dusk", "night"];

export function localPhase(now = new Date(), search = "") {
    const pinned = new URLSearchParams(search).get("phase");
    if (PHASE_NAMES.includes(pinned)) return pinned;
    const h = now.getHours();
    if (h >= 5 && h < 8) return "dawn";
    if (h >= 8 && h < 17) return "day";
    if (h >= 17 && h < 20) return "dusk";
    return "night";
}

/*
 * What changed between two snapshots, as things that happened: a tree came
 * down, a rock was broken, a patch of ground was dug or piled. The world
 * throws a puff of chips or earth for each (see puffs.js) and tells anyone
 * listening, which is how the sound knows a shovel bit (see commons/sound.js).
 *
 * Pure, so it can be tested without a scene.
 */

/* Tiles that became a stump or rubble since `before` (a Set of "x,y"). */
export function newlyCleared(before, cells) {
    const found = [];
    cells.forEach((c) => {
        if (c.kind !== "stump" && c.kind !== "rubble") return;
        if (!before.has(`${c.x},${c.y}`)) found.push({ x: c.x, y: c.y, kind: c.kind });
    });
    return found;
}

export function clearedSet(cells) {
    const set = new Set();
    cells.forEach((c) => {
        if (c.kind === "stump" || c.kind === "rubble") set.add(`${c.x},${c.y}`);
    });
    return set;
}

/*
 * Tiles whose dig edit differs between two GroundMap.byChunk maps, looking
 * only at the chunks that `changed` names (see below for new ones). Each
 * comes back with the edit it has now (undefined once levelled back).
 */
export function changedEdits(before, after, changed) {
    const out = [];
    changed.forEach((key) => {
        /* A chunk heard of for the first time has mostly just come into
           view, and nothing happened in it. The server lists every chunk in
           view, edited or not; the offline stand-in only those it has dug,
           so a fresh chunk with a single edit is the first swing in it. */
        if (!before.has(key) && (after.get(key) || []).length !== 1) return;
        const was = new Map((before.get(key) || []).map((g) => [`${g.x},${g.y}`, g.edit]));
        const now = after.get(key) || [];
        now.forEach((g) => {
            const k = `${g.x},${g.y}`;
            if (was.get(k) !== g.edit) out.push({ x: g.x, y: g.y, edit: g.edit });
            was.delete(k);
        });
        was.forEach((_, k) => {
            const [x, y] = k.split(",").map(Number);
            out.push({ x, y, edit: undefined });
        });
    });
    return out;
}

/* A snapshot's worth of changes is news only when it is small: the first
   snapshot, or walking into a stretch of old diggings, is not a dozen
   shovels at once. */
export const NEWS_LIMIT = 6;
export function asNews(list) {
    return list.length > NEWS_LIMIT ? [] : list;
}

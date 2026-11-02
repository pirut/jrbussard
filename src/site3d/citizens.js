import { buildSurvivor, disposeModel, pose } from "../arcade/ascii3d/models";
import { PALETTES, APPEARANCE_OPTIONS } from "../lib/appearance";
import { KIND } from "../world/tiles";

/*
 * The people of the city: figures from the Commons, walking the avenues
 * and wandering the rooms. They only make the place lived in; nothing
 * about them is solid, and they never get in your way.
 *
 * Pure decoration, owned by SiteScene (the only caller) and driven from its
 * frame loop. They are not simulated anywhere else: no server, no collision
 * with JR, no effect on the tile world (World.js never hears of them), and
 * not synchronised between browsers, so two people looking at the same
 * street see different crowds. Real other visitors are visitors.js.
 *
 * Invariants: they only ever step between walkable tile centres, one orthogonal
 * tile at a time, so they cannot clip a wall; and per-frame cost is kept down
 * by culling, not by count: a figure beyond SEEN of the camera focus is hidden
 * and not animated at all (it keeps its place and resumes when you return).
 */

/* Crowd size for the whole city. A fixed number, not a density: each one is
   a full jointed survivor model, so this is the knob for scene cost. */
const COUNT = 64;
/* Tiles from the camera focus beyond which a figure is hidden and frozen.
   Comfortably past half the widest zoom (SiteScene ZOOMS tops out at 24
   tiles top to bottom), so no one visibly blinks in at the screen edge.
   Matches the same cull in visitors.js. */
const SEEN = 46;
/* The four tile moves, north first (y grows south). */
const STEPS = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
];

/* mulberry32: a tiny seeded generator, so the crowd's looks and starting
   places are the same on every load of the same world. (Their later wandering
   also draws from it, but in frame order, so it diverges with timing.) */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(random, list) {
    return list[Math.floor(random() * list.length)];
}

export class Citizens {
    /* `world` is the tile world from world/build.js (w, h, kindAt, isSolid);
       `heightAt(x, y)` is SiteScene.standHeight, the ground a figure stands
       on at a tile, so they follow kerbs and room floors. Everyone is placed
       up front on a random walkable tile and added to `scene` at once. */
    constructor(scene, world, heightAt) {
        this.scene = scene;
        this.world = world;
        this.heightAt = heightAt;
        /* An arbitrary constant (it reads as a date); any fixed value would do. */
        this.random = rng(20261010);
        const spots = [];
        for (let y = 0; y < world.h; y += 1) {
            for (let x = 0; x < world.w; x += 1) if (this.walkable(x, y)) spots.push([x, y]);
        }
        this.people = [];
        for (let i = 0; i < COUNT && spots.length; i += 1) {
            const [x, y] = spots[Math.floor(this.random() * spots.length)];
            const r = this.random;
            const model = buildSurvivor({
                appearance: {
                    skin: pick(r, Object.keys(PALETTES.skin)),
                    hair: pick(r, Object.keys(PALETTES.hair)),
                    outfit: pick(r, Object.keys(PALETTES.outfit)),
                    cloak: pick(r, Object.keys(PALETTES.cloak)),
                    hairstyle: pick(r, APPEARANCE_OPTIONS.hairstyle),
                    headwear: pick(r, APPEARANCE_OPTIONS.headwear),
                },
            });
            /* A little taller or shorter than JR (1.1) so a crowd is not clones. */
            model.scale.setScalar(1.1 + r() * 0.2);
            model.position.set(x, heightAt(x, y), y);
            scene.add(model);
            this.people.push({
                model,
                at: [x, y],
                to: [x, y],
                dir: pick(r, STEPS),
                /* Progress along the current step, 0..1; starting at 1 means
                   "arrived", so the first thing update() does is choose a way. */
                t: 1,
                /* Seconds per tile: 0.45-0.75, so roughly 1.3-2.2 tiles/s. */
                pace: 0.45 + r() * 0.3,
                /* Stand for up to three seconds first, so they do not all
                   step off in unison on the first frame. */
                wait: r() * 3,
                stride: 0,
                moving: 0,
                yaw: 0,
            });
        }
    }

    /* Where a person may stand: the site map's own isSolid rule
       (world/tiles.js SOLID: walls, blocks, trees, interactive props) and not
       water or the void. A doorway in a room's wall is a non-wall tile, so it
       is walkable and people do pass in and out of rooms. */
    walkable(x, y) {
        const kind = this.world.kindAt(x, y);
        return !this.world.isSolid(x, y) && kind !== KIND.WATER && kind !== KIND.VOID;
    }

    /* Keep walking the way you were going, mostly; turn at corners; never
       turn straight back unless the way ahead is shut. */
    choose(p) {
        const [x, y] = p.at;
        const open = STEPS.filter(([dx, dy]) => this.walkable(x + dx, y + dy));
        if (!open.length) return null;
        const ahead = open.find(([dx, dy]) => dx === p.dir[0] && dy === p.dir[1]);
        if (ahead && this.random() < 0.8) return ahead;
        const turns = open.filter(([dx, dy]) => dx !== -p.dir[0] || dy !== -p.dir[1]);
        return pick(this.random, turns.length ? turns : open);
    }

    /* Called every frame by SiteScene. `dt` is seconds since last frame (the
       scene passes 0 under reduced motion, which freezes everyone in place
       but leaves them drawn); `time` is scene seconds for idle sway; `focus`
       is the camera's Vector3 target, used only for the SEEN cull. */
    update(dt, time, focus) {
        this.people.forEach((p) => {
            const near = Math.hypot(p.model.position.x - focus.x, p.model.position.z - focus.z) < SEEN;
            p.model.visible = near;
            if (!near || !dt) return;
            let walking = false;
            if (p.wait > 0) p.wait -= dt;
            else {
                p.t += dt / p.pace;
                walking = true;
                if (p.t >= 1) {
                    p.at = p.to;
                    p.t = 0;
                    const step = this.choose(p);
                    if (!step || this.random() < 0.04) {
                        /* Stop a while, to look at something. */
                        p.wait = 1 + this.random() * 4;
                        p.t = 1;
                        walking = false;
                    } else {
                        p.dir = step;
                        p.to = [p.at[0] + step[0], p.at[1] + step[1]];
                    }
                }
            }
            const k = Math.min(1, p.t);
            const x = p.at[0] + (p.to[0] - p.at[0]) * k;
            const z = p.at[1] + (p.to[1] - p.at[1]) * k;
            const moved = Math.hypot(x - p.model.position.x, z - p.model.position.z);
            p.model.position.set(x, this.heightAt(Math.round(x), Math.round(z)), z);
            /* Stride phase advances with distance walked, the same 4.6 per tile
               as JR's walk in SiteScene, so feet keep pace with the ground. */
            p.stride += moved * 4.6;
            p.moving += ((walking ? 1 : 0) - p.moving) * Math.min(1, dt * 8);
            /* Face the way of travel (model forward is +z), turning by the
               shortest way round and easing so corners read as turns. */
            const goal = Math.atan2(p.dir[0], p.dir[1]);
            let d = goal - p.yaw;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            p.yaw += d * Math.min(1, dt * 8);
            p.model.rotation.y = p.yaw;
            pose(p.model, { stride: p.stride, moving: p.moving, t: time });
        });
    }

    /* Releases each model's geometry hold (see figureGeometry.js); SiteScene
       also sweeps the scene with releaseFigure on its own dispose. */
    dispose() {
        this.people.forEach((p) => {
            this.scene.remove(p.model);
            disposeModel(p.model);
        });
        this.people = [];
    }
}

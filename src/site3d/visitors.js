import * as THREE from "three";
import { buildSurvivor, disposeModel, pose } from "../arcade/ascii3d/models";
import { PALETTES, APPEARANCE_OPTIONS } from "../lib/appearance";

/*
 * The other people walking the site right now, as Convex reports them
 * (see convex/site.ts). Positions arrive a few times a second, so each
 * figure eases toward where it was last heard of and walks while it does;
 * a name floats over each head. Like the citizens, they are never solid.
 *
 * Client-only rendering of data that arrives via Presence.js
 * (-> SiteScene.setVisitors -> Visitors.set). The server only relays what
 * each browser claimed about itself, so nothing here is authoritative or
 * collidable; a visitor can be anywhere, and this just draws them there.
 * Everything is keyed by the server's row id (never the session), and the
 * model, its DOM name label and its easing state live and die together in
 * `people`.
 *
 * Costs: names are real DOM spans (so they stay in the page's own type and
 * are not run through the ASCII pass), positioned by transform each frame
 * with no layout reads. Figures farther than SEEN from the camera focus are
 * hidden and skip posing, but their position still eases so they are in the
 * right place when you arrive.
 */

/* Further than this between updates is a jump between rooms, not a walk
   (tiles). Easing across a jump would drag the figure through walls, so it
   snaps instead. Rooms are travelled between by number key in World.js. */
const SNAP = 4;
/* Cull distance in tiles from the camera focus; same as citizens.js. */
const SEEN = 46;

const tmp = new THREE.Vector3();

/* FNV-1a over the id's characters to seed mulberry32 (the same generator as
   citizens.js), so a given id always yields the same stream. */
function seeded(text) {
    let a = 2166136261;
    for (let i = 0; i < text.length; i += 1) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Someone with no Commons character still gets a look of their own, the
   same one every time. Derived from the row id, so every viewer sees the
   same outfit for the same person, without anything being stored. */
function lookFor(id) {
    const r = seeded(id);
    const pick = (list) => list[Math.floor(r() * list.length)];
    return {
        skin: pick(Object.keys(PALETTES.skin)),
        hair: pick(Object.keys(PALETTES.hair)),
        outfit: pick(Object.keys(PALETTES.outfit)),
        cloak: pick(Object.keys(PALETTES.cloak)),
        hairstyle: pick(APPEARANCE_OPTIONS.hairstyle),
        headwear: pick(APPEARANCE_OPTIONS.headwear),
    };
}

/* A cheap identity for an appearance, to notice when someone has changed
   clothes at the Commons. Relies on the server returning the fields in a
   stable order. (Not models.js's lookKey, which takes a whole player and
   also folds in armour and weapon, which visitors do not carry.) */
function lookKey(appearance) {
    return appearance ? Object.values(appearance).join(",") : "";
}

export class Visitors {
    /* `labelLayer` is the DOM element SiteScene overlays on the canvas for
       names; `heightAt(x, y)` is SiteScene.standHeight. */
    constructor(scene, labelLayer, heightAt) {
        this.scene = scene;
        this.labelLayer = labelLayer;
        this.heightAt = heightAt;
        this.people = new Map();
    }

    /* The latest list from the server (shape: the convex/site.ts `visitors`
       query, with x, y in tiles and facing in radians); anyone missing from
       it has left. Sets goals only. Movement happens in update(). */
    set(list) {
        const here = new Set();
        list.forEach((v) => {
            here.add(v.id);
            let p = this.people.get(v.id);
            const look = lookKey(v.appearance);
            /* New clothes mean a new model: figures are built once from their
               appearance, so rebuild rather than patch. */
            if (p && p.look !== look) {
                this.remove(v.id);
                p = null;
            }
            if (!p) {
                p = this.add(v, look);
            }
            p.goal.x = v.x;
            p.goal.y = v.y;
            p.facing = v.facing;
            p.running = v.running;
            if (p.label.textContent !== v.name) p.label.textContent = v.name;
        });
        [...this.people.keys()].forEach((id) => {
            if (!here.has(id)) this.remove(id);
        });
    }

    /* Spawns at the reported spot, not at the origin, so a newcomer does not
       slide in from across the map. */
    add(v, look) {
        const model = buildSurvivor({ appearance: v.appearance || lookFor(String(v.id)) });
        model.scale.setScalar(1.1);
        model.position.set(v.x, this.heightAt(Math.round(v.x), Math.round(v.y)), v.y);
        model.rotation.y = v.facing;
        this.scene.add(model);
        const label = document.createElement("span");
        label.className = "site3d__label site3d__label--visitor";
        label.textContent = v.name;
        /* Hidden until updateLabels has projected it somewhere on screen. */
        label.style.visibility = "hidden";
        this.labelLayer.appendChild(label);
        const p = { model, label, look, goal: { x: v.x, y: v.y }, facing: v.facing, running: false, yaw: v.facing, stride: 0, moving: 0 };
        this.people.set(v.id, p);
        return p;
    }

    remove(id) {
        const p = this.people.get(id);
        if (!p) return;
        this.scene.remove(p.model);
        disposeModel(p.model);
        p.label.remove();
        this.people.delete(id);
    }

    /* How many are currently drawn, for the HUD. */
    get count() {
        return this.people.size;
    }

    /* Per frame. `dt` seconds, `time` scene seconds (idle sway), `focus` the
       camera target Vector3 for the cull. Positions are eased frame-rate
       independently (1 - e^(-9 dt) is the same fraction of the gap per
       second at any frame rate), which hides the 150 ms+ spacing of network
       updates. */
    update(dt, time, focus) {
        this.people.forEach((p) => {
            const m = p.model;
            const gap = Math.hypot(p.goal.x - m.position.x, p.goal.y - m.position.z);
            const near = Math.hypot(m.position.x - focus.x, m.position.z - focus.z) < SEEN;
            m.visible = near;
            let x = p.goal.x;
            let z = p.goal.y;
            if (gap < SNAP && dt) {
                const k = 1 - Math.exp(-dt * 9);
                x = m.position.x + (p.goal.x - m.position.x) * k;
                z = m.position.z + (p.goal.y - m.position.z) * k;
            }
            const moved = Math.hypot(x - m.position.x, z - m.position.z);
            const ground = this.heightAt(Math.round(x), Math.round(z));
            const h = gap < SNAP ? m.position.y + (ground - m.position.y) * Math.min(1, dt * 18) : ground;
            m.position.set(x, h, z);
            if (!near) return;
            /* Walk while there is still ground to cover to the goal. */
            const walking = gap > 0.05;
            /* Same stride constants as JR in SiteScene.updatePlayer: running
               advances the phase less per tile, so each step spans more ground. */
            p.stride += moved * (p.running ? 3.6 : 4.6);
            p.moving += ((walking ? 1 : 0) - p.moving) * Math.min(1, dt * 10);
            let d = p.facing - p.yaw;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            p.yaw += d * Math.min(1, dt * 12);
            m.rotation.y = p.yaw;
            pose(m, { stride: p.stride, moving: p.moving, t: time });
        });
    }

    /* Names over heads, placed on the page by the same projection as the
       room labels. `toScreen` takes a world-space Vector3 (it is a shared
       scratch object, so do not keep it) and returns CSS pixel {x, y} or null
       for anything off screen; `show` is false on the front-door intro. The
       +2.3 lifts the anchor from the feet to just above the head. */
    updateLabels(toScreen, show) {
        this.people.forEach((p) => {
            const at = show && p.model.visible ? toScreen(tmp.set(p.model.position.x, p.model.position.y + 2.3, p.model.position.z)) : null;
            if (!at) {
                if (p.label.style.visibility !== "hidden") p.label.style.visibility = "hidden";
                return;
            }
            p.label.style.visibility = "visible";
            p.label.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
        });
    }

    dispose() {
        [...this.people.keys()].forEach((id) => this.remove(id));
    }
}

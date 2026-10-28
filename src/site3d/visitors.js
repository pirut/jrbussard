import * as THREE from "three";
import { buildSurvivor, pose } from "../arcade/ascii3d/models";
import { PALETTES, APPEARANCE_OPTIONS } from "../lib/appearance";

/*
 * The other people walking the site right now, as Convex reports them
 * (see convex/site.ts). Positions arrive a few times a second, so each
 * figure eases toward where it was last heard of and walks while it does;
 * a name floats over each head. Like the citizens, they are never solid.
 */

/* Further than this between updates is a jump between rooms, not a walk. */
const SNAP = 4;
const SEEN = 46;

const tmp = new THREE.Vector3();

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
   same one every time. */
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

function lookKey(appearance) {
    return appearance ? Object.values(appearance).join(",") : "";
}

export class Visitors {
    constructor(scene, labelLayer, heightAt) {
        this.scene = scene;
        this.labelLayer = labelLayer;
        this.heightAt = heightAt;
        this.people = new Map();
    }

    /* The latest list from the server; anyone missing from it has left. */
    set(list) {
        const here = new Set();
        list.forEach((v) => {
            here.add(v.id);
            let p = this.people.get(v.id);
            const look = lookKey(v.appearance);
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

    add(v, look) {
        const model = buildSurvivor({ appearance: v.appearance || lookFor(String(v.id)) });
        model.scale.setScalar(1.1);
        model.position.set(v.x, this.heightAt(Math.round(v.x), Math.round(v.y)), v.y);
        model.rotation.y = v.facing;
        this.scene.add(model);
        const label = document.createElement("span");
        label.className = "site3d__label site3d__label--visitor";
        label.textContent = v.name;
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
        p.label.remove();
        this.people.delete(id);
    }

    get count() {
        return this.people.size;
    }

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
            const walking = gap > 0.05;
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
       room labels. `toScreen` returns null for anything off screen. */
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

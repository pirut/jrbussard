import { buildSurvivor, pose } from "../arcade/ascii3d/models";
import { PALETTES, APPEARANCE_OPTIONS } from "../lib/appearance";
import { KIND } from "../world/tiles";

/*
 * The people of the city: figures from the Commons, walking the avenues
 * and wandering the rooms. They only make the place lived in; nothing
 * about them is solid, and they never get in your way.
 */

const COUNT = 64;
const SEEN = 46;
const STEPS = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
];

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
    constructor(scene, world, heightAt) {
        this.scene = scene;
        this.world = world;
        this.heightAt = heightAt;
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
            model.scale.setScalar(1.1 + r() * 0.2);
            model.position.set(x, heightAt(x, y), y);
            scene.add(model);
            this.people.push({
                model,
                at: [x, y],
                to: [x, y],
                dir: pick(r, STEPS),
                t: 1,
                pace: 0.45 + r() * 0.3,
                wait: r() * 3,
                stride: 0,
                moving: 0,
                yaw: 0,
            });
        }
    }

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
            p.stride += moved * 4.6;
            p.moving += ((walking ? 1 : 0) - p.moving) * Math.min(1, dt * 8);
            const goal = Math.atan2(p.dir[0], p.dir[1]);
            let d = goal - p.yaw;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            p.yaw += d * Math.min(1, dt * 8);
            p.model.rotation.y = p.yaw;
            pose(p.model, { stride: p.stride, moving: p.moving, t: time });
        });
    }

    dispose() {
        this.people.forEach((p) => this.scene.remove(p.model));
        this.people = [];
    }
}

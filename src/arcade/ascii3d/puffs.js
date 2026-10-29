import * as THREE from "three";
import { glyphCode, GLYPH_SETS } from "./asciiPass";

/*
 * Bits thrown up by work: sawdust and chips off a felled tree, grit off a
 * broken rock, a spray of earth from the shovel, and a ring of dust where a
 * piece of building lands or comes down. One instanced mesh for all of it,
 * so a busy camp costs a single draw call.
 *
 * The motion is plain arithmetic (puffAt) so it can be tested without a GPU.
 */

/* Per kind: colours to pick from, how many bits, how fast they fly out and
   up, how heavy they are, how long they last, and how big. */
export const PUFF_KINDS = {
    wood: { colors: [0xc89a62, 0x8a6238, 0xe0c08a], count: 10, out: 1.8, up: 2.6, gravity: 9, life: 0.55, size: 1 },
    stone: { colors: [0xb4bab4, 0x7f877f, 0xdad9cf], count: 9, out: 2.2, up: 2.2, gravity: 11, life: 0.45, size: 0.85 },
    earth: { colors: [0x8a6a44, 0x6b5035, 0xa58156], count: 12, out: 1.5, up: 3, gravity: 10, life: 0.6, size: 1 },
    dust: { colors: [0xcfc3a8, 0xa89f8a], count: 14, out: 2.4, up: 0.7, gravity: 1.5, life: 0.7, size: 1.3 },
    leaf: { colors: [0x6fae4a, 0x4f8a36, 0xa8c85a], count: 8, out: 1.2, up: 1.6, gravity: 2.5, life: 0.9, size: 0.9 },
};

/*
 * Where a bit is `t` seconds after it was thrown, and how big it still is,
 * or null once it has landed and gone. Bits shrink over their last half,
 * so they fade out of the ASCII rather than blink off.
 */
export function puffAt(seed, t) {
    if (!seed || t < 0 || t >= seed.life) return null;
    const k = t / seed.life;
    /* A little air drag, so they slow as they spread instead of flying
       straight out. */
    const drift = (1 - Math.exp(-3 * t)) / 3;
    const y = Math.max(seed.floor, seed.y + seed.vy * t - 0.5 * seed.gravity * t * t);
    return {
        x: seed.x + seed.vx * drift,
        y,
        z: seed.z + seed.vz * drift,
        scale: seed.size * (k < 0.5 ? 1 : 1 - (k - 0.5) * 2),
    };
}

/* The bits for one puff at `at` (x, y, z), each with its own way out. */
export function throwPuff(kind, at, born, random = Math.random) {
    const spec = PUFF_KINDS[kind] || PUFF_KINDS.dust;
    const seeds = [];
    for (let i = 0; i < spec.count; i += 1) {
        const a = (i / spec.count) * Math.PI * 2 + random() * 0.8;
        const speed = spec.out * (0.5 + random() * 0.7);
        seeds.push({
            born,
            x: at.x + (random() - 0.5) * 0.3,
            y: at.y + 0.15 + random() * 0.2,
            z: at.z + (random() - 0.5) * 0.3,
            floor: at.y,
            vx: Math.cos(a) * speed,
            vy: spec.up * (0.5 + random() * 0.7),
            vz: Math.sin(a) * speed,
            gravity: spec.gravity,
            life: spec.life * (0.75 + random() * 0.5),
            size: spec.size * (0.7 + random() * 0.6),
            color: spec.colors[Math.floor(random() * spec.colors.length)],
        });
    }
    return seeds;
}

const m4 = new THREE.Matrix4();
const colour = new THREE.Color();

export class Puffs {
    /* `still` (reduced motion) throws nothing: the bits are only for show. */
    constructor(scene, { capacity = 160, still = false } = {}) {
        this.still = still;
        this.seeds = new Array(capacity).fill(null);
        this.next = 0;
        this.live = 0;
        this.mesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.08, 0.08, 0.08),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                blending: THREE.NoBlending,
                transparent: false,
                opacity: glyphCode(GLYPH_SETS.rock),
            }),
            capacity,
        );
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;
        m4.makeScale(0, 0, 0);
        for (let i = 0; i < capacity; i += 1) {
            this.mesh.setMatrixAt(i, m4);
            this.mesh.setColorAt(i, colour.setHex(0xffffff));
        }
        scene.add(this.mesh);
        this.scene = scene;
    }

    /* Throw a puff of `kind` from the point `at`. */
    add(kind, at, time) {
        if (this.still) return;
        throwPuff(kind, at, time).forEach((seed) => {
            const i = this.next;
            this.next = (i + 1) % this.seeds.length;
            this.seeds[i] = seed;
            this.mesh.setColorAt(i, colour.setHex(seed.color));
        });
        this.mesh.instanceColor.needsUpdate = true;
        this.live = this.seeds.length;
        this.mesh.visible = true;
    }

    update(time) {
        if (!this.live) return;
        let any = 0;
        for (let i = 0; i < this.seeds.length; i += 1) {
            const seed = this.seeds[i];
            if (!seed) continue;
            const p = puffAt(seed, time - seed.born);
            if (!p) {
                this.seeds[i] = null;
                m4.makeScale(0, 0, 0);
            } else {
                any += 1;
                m4.makeScale(p.scale, p.scale, p.scale).setPosition(p.x, p.y, p.z);
            }
            this.mesh.setMatrixAt(i, m4);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.live = any;
        this.mesh.visible = any > 0;
    }

    dispose() {
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.mesh.dispose?.();
    }
}

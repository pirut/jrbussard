import * as THREE from "three";
import { material, ownMaterial, asFigure, hitFlash } from "./materials";
import { PALETTES, appearanceOf } from "../../lib/appearance";

/*
 * The people, creatures and buildings of the Commons, as real low-poly models.
 *
 * Everything is built from boxes, cones and spheres at load. Each figure is a
 * hierarchy of pivots — hips, knees, shoulders, elbows, neck — so walking is a
 * matter of bending limbs about their joints, not swapping sprites. Proportions are
 * chunky on purpose: at a few characters per limb, a thin arm vanishes.
 *
 * Coordinates: one tile is one unit, x runs east, z runs south, y is up.
 * A model faces +z (south, toward the default camera) at rotation 0.
 */

const geometryCache = new Map();
function geo(key, make) {
    if (!geometryCache.has(key)) geometryCache.set(key, make());
    return geometryCache.get(key);
}
const boxGeo = (w, h, d) => geo(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));

function part(geometry, mat, x = 0, y = 0, z = 0, cast = true) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    return mesh;
}

function box(w, h, d, color, set, x, y, z, options) {
    return part(boxGeo(w, h, d), material(color, set, options), x, y, z);
}

/* Rounded parts, so a figure shades in smooth ramps of characters instead
   of flat slabs. Geometry is cached: a crowd shares one of each. */
const capsuleGeo = (r, len) => geo(`cap${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 3, 10));
const sphereGeo = (r, sx = 1, sy = 1, sz = 1) =>
    geo(`sph${r},${sx},${sy},${sz}`, () => new THREE.SphereGeometry(r, 14, 10).scale(sx, sy, sz));
const taperGeo = (rt, rb, h, seg = 10, sz = 1) =>
    geo(`tap${rt},${rb},${h},${seg},${sz}`, () => new THREE.CylinderGeometry(rt, rb, h, seg).scale(1, 1, sz));
/* The top half of a sphere: caps of hair, hoods, pauldrons. */
const domeGeo = (r, sx = 1, sy = 1, sz = 1, cut = 0.55) =>
    geo(`dome${r},${sx},${sy},${sz},${cut}`, () =>
        new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI * cut).scale(sx, sy, sz),
    );
const coneGeo = (r, h, seg = 8) => geo(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
/* A cape: a slab that flares toward the hem. */
const capeGeo = () =>
    geo("cape", () => {
        const g = new THREE.BoxGeometry(0.46, 0.8, 0.04, 2, 4, 1);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i += 1) {
            const y = p.getY(i);
            const flare = 1 + (0.4 - y) * 0.45;
            p.setX(i, p.getX(i) * flare);
            p.setZ(i, p.getZ(i) - (0.4 - y) * (0.4 - y) * 0.12);
        }
        g.computeVertexNormals();
        return g;
    });

function add(parent, geometry, color, x, y, z, set = "solid", options) {
    const mesh = part(geometry, material(color, set, options), x, y, z);
    parent.add(mesh);
    return mesh;
}

/* A two-part limb: the upper half hangs from the hip or shoulder, the lower
   from the knee or elbow, so a stride can lift a foot instead of swinging a
   stilt. Capsules overlap at the joint, so a bent knee stays whole. */
function jointed(parent, x, y, z, r, upper, lower, color, lowerColor = color, lowerR = r * 0.88) {
    const top = new THREE.Group();
    top.position.set(x, y, z);
    add(top, capsuleGeo(r, upper), color, 0, -upper / 2, 0);
    const joint = new THREE.Group();
    joint.position.y = -upper;
    add(joint, capsuleGeo(lowerR, lower), lowerColor, 0, -lower / 2, 0);
    top.add(joint);
    parent.add(top);
    return { top, joint };
}

/* People and creatures draw in the figure set; see asciiPass.js. */
function figurize(root) {
    root.traverse((node) => {
        if (node.isMesh) node.material = asFigure(node.material);
    });
    return root;
}

function darker(hex, amount = 0.72) {
    return new THREE.Color(hex).multiplyScalar(amount).getHex();
}

/* ── People ─────────────────────────────────────────────────────────────── */

/*
 * A survivor, about 1.7 tiles tall with a slightly large head, so a face
 * still reads when the whole figure is a dozen characters high.
 */
function buildHumanoid(look) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const bulk = look.bulk || 1;

    /* Legs from the hip, with a boot that has a toe. */
    const legL = jointed(body, -0.1, 0.66, 0, 0.075 * bulk, 0.3, 0.28, look.legs);
    const legR = jointed(body, 0.1, 0.66, 0, 0.075 * bulk, 0.3, 0.28, look.legs);
    [legL, legR].forEach((leg) => {
        add(leg.joint, taperGeo(0.085, 0.095, 0.16, 8), look.boots, 0, -0.22, 0);
        add(leg.joint, sphereGeo(0.09, 1, 0.6, 1.5), look.boots, 0, -0.3, 0.05);
    });

    const torso = new THREE.Group();
    torso.position.y = 0.66;
    body.add(torso);
    /* Pelvis, a chest that narrows to the waist, and a belt between. */
    add(torso, taperGeo(0.17 * bulk, 0.16 * bulk, 0.14, 10, 0.7), look.legs, 0, 0.0, 0);
    add(torso, taperGeo(0.23 * bulk, 0.17 * bulk, 0.42, 10, 0.68), look.torso, 0, 0.27, 0);
    add(torso, taperGeo(0.175 * bulk, 0.175 * bulk, 0.06, 10, 0.72), look.belt, 0, 0.07, 0);
    add(torso, sphereGeo(0.03), "#c9b27a", 0, 0.07, 0.125 * bulk);
    if (look.armor >= 2) {
        /* Plate: a breastplate and rounded pauldrons. */
        add(torso, taperGeo(0.24 * bulk, 0.19 * bulk, 0.3, 10, 0.72), look.plate, 0, 0.33, 0);
        add(torso, domeGeo(0.12, 1, 0.8, 1), look.plate, -0.25 * bulk, 0.44, 0);
        add(torso, domeGeo(0.12, 1, 0.8, 1), look.plate, 0.25 * bulk, 0.44, 0);
    } else if (look.armor === 1) {
        /* A padded coat that flares into a short skirt. */
        add(torso, taperGeo(0.24 * bulk, 0.19 * bulk, 0.34, 10, 0.72), look.coat, 0, 0.3, 0, "grass");
        add(torso, taperGeo(0.19 * bulk, 0.25 * bulk, 0.22, 10, 0.78), look.coat, 0, -0.05, 0, "grass");
    }

    const shoulder = 0.24 * bulk;
    const armR0 = 0.062 * bulk;
    const armL = jointed(torso, -shoulder, 0.44, 0, armR0, 0.22, 0.2, look.sleeves);
    const armR = jointed(torso, shoulder, 0.44, 0, armR0, 0.22, 0.2, look.sleeves);
    [armL, armR].forEach((arm) => {
        add(arm.top, sphereGeo(0.08 * bulk), look.sleeves, 0, 0, 0);
        add(arm.joint, sphereGeo(0.062 * bulk, 1, 1.1, 1), look.skin, 0, -0.27, 0.01);
    });

    if (look.cloak) {
        const cape = new THREE.Group();
        cape.position.set(0, 0.47, -0.12);
        add(cape, capeGeo(), look.cloak, 0, -0.4, 0);
        add(cape, taperGeo(0.15, 0.2, 0.05, 10, 0.75), look.cloak, 0, -0.005, 0.1);
        torso.add(cape);
        root.userData.cape = cape;
    }

    const neck = new THREE.Group();
    neck.position.y = 0.48;
    torso.add(neck);
    add(neck, taperGeo(0.06, 0.07, 0.1, 8), look.skin, 0, 0.03, 0);
    const head = new THREE.Group();
    head.position.y = 0.2;
    neck.add(head);
    add(head, sphereGeo(0.19, 0.95, 1.05, 1), look.skin, 0, 0, 0);
    /* A face: eyes, brows and a nose catch the light and give the head a
       front, which is most of what makes a lump of characters a person. */
    add(head, sphereGeo(0.032, 1, 1.2, 0.6), "#1b1a1f", -0.068, 0.015, 0.165);
    add(head, sphereGeo(0.032, 1, 1.2, 0.6), "#1b1a1f", 0.068, 0.015, 0.165);
    add(head, boxGeo(0.07, 0.018, 0.02), darker(look.hair, 0.8), -0.07, 0.07, 0.17);
    add(head, boxGeo(0.07, 0.018, 0.02), darker(look.hair, 0.8), 0.07, 0.07, 0.17);
    add(head, coneGeo(0.03, 0.08, 6), darker(look.skin, 0.92), 0, -0.03, 0.19).rotation.x = Math.PI / 2;
    add(head, boxGeo(0.07, 0.014, 0.02), darker(look.skin, 0.6), 0, -0.095, 0.165);
    add(head, sphereGeo(0.04, 0.6, 1, 1), look.skin, -0.185, 0, 0);
    add(head, sphereGeo(0.04, 0.6, 1, 1), look.skin, 0.185, 0, 0);
    addHair(head, look);
    addHeadwear(head, look);

    if (look.weapon) {
        const held = new THREE.Group();
        held.position.set(0, -0.27, 0.03);
        held.rotation.x = Math.PI / 2.4;
        if (look.weapon >= 2) {
            add(held, taperGeo(0.025, 0.025, 0.14, 6), "#5a4632", 0, 0, 0);
            add(held, sphereGeo(0.035), "#c9b27a", 0, -0.08, 0);
            add(held, boxGeo(0.24, 0.04, 0.06), "#9c7a4d", 0, 0.08, 0);
            const blade = add(held, boxGeo(0.07, 0.6, 0.02), "#dfe4de", 0, 0.4, 0);
            blade.scale.set(1, 1, 1);
            add(held, coneGeo(0.05, 0.1, 4), "#dfe4de", 0, 0.75, 0).scale.set(1, 1, 0.3);
        } else {
            add(held, taperGeo(0.024, 0.028, 1.1, 6), "#9c7a4d", 0, 0.3, 0, "timber");
            add(held, coneGeo(0.055, 0.2, 4), "#b0b9b2", 0, 0.94, 0, "rock");
        }
        armR.joint.add(held);
    }

    root.userData.rig = { body, torso, legL, legR, armL, armR, neck, head };
    return root;
}

function addHair(head, look) {
    const hair = look.hair;
    if (look.headwear === "hood") return;
    switch (look.hairstyle) {
        case "long":
            add(head, domeGeo(0.205, 1, 1.05, 1.05), hair, 0, 0.01, -0.01);
            add(head, taperGeo(0.17, 0.15, 0.38, 10, 0.55), hair, 0, -0.13, -0.09);
            break;
        case "braids":
            add(head, domeGeo(0.205, 1, 1.05, 1.05), hair, 0, 0.01, -0.01);
            [-1, 1].forEach((side) => {
                add(head, capsuleGeo(0.04, 0.3), hair, side * 0.16, -0.2, -0.05);
                add(head, sphereGeo(0.035), "#c9b27a", side * 0.16, -0.39, -0.05);
            });
            break;
        case "shaved":
            add(head, domeGeo(0.196, 1, 1.02, 1.02, 0.4), hair, 0, 0.02, -0.005);
            break;
        default:
            /* Cropped, with a fringe that sweeps to one side. */
            add(head, domeGeo(0.205, 1, 1.05, 1.05), hair, 0, 0.01, -0.01);
            add(head, sphereGeo(0.09, 1.6, 0.6, 0.7), hair, 0.05, 0.13, 0.12).rotation.z = -0.3;
    }
}

function addHeadwear(head, look) {
    const cloth = look.cloak || look.torso;
    switch (look.headwear) {
        case "hood":
            add(head, sphereGeo(0.235, 1, 1.05, 1.05), cloth, 0, 0.02, -0.04);
            add(head, coneGeo(0.12, 0.2, 8), cloth, 0, 0.05, -0.22).rotation.x = -1.9;
            /* The face shows through the opening. */
            add(head, sphereGeo(0.15, 1, 1.1, 0.5), darker(cloth, 0.45), 0, 0, 0.11);
            add(head, sphereGeo(0.03, 1, 1.2, 0.6), "#e8e2cf", -0.06, 0.01, 0.17);
            add(head, sphereGeo(0.03, 1, 1.2, 0.6), "#e8e2cf", 0.06, 0.01, 0.17);
            break;
        case "brim":
            add(head, taperGeo(0.34, 0.34, 0.03, 16), "#6e5b43", 0, 0.14, 0);
            add(head, taperGeo(0.15, 0.19, 0.17, 12), "#6e5b43", 0, 0.24, 0);
            add(head, taperGeo(0.192, 0.192, 0.035, 12), "#3f3326", 0, 0.17, 0);
            break;
        case "crown":
            add(head, taperGeo(0.2, 0.19, 0.08, 10), "#e3c25f", 0, 0.17, 0, "fire");
            for (let i = 0; i < 5; i += 1) {
                const a = (i / 5) * Math.PI * 2;
                add(head, coneGeo(0.04, 0.12, 4), "#e3c25f", Math.sin(a) * 0.18, 0.26, Math.cos(a) * 0.18, "fire");
            }
            add(head, sphereGeo(0.03), "#d6455f", 0, 0.18, 0.2, "fire");
            break;
        default:
    }
}

/* The look of a survivor, from what they chose and what they have earned. */
export function survivorLook(player) {
    const a = appearanceOf(player);
    const outfit = PALETTES.outfit[a.outfit];
    const armor = player?.tools?.armor || 0;
    return {
        skin: PALETTES.skin[a.skin],
        hair: PALETTES.hair[a.hair],
        hairstyle: a.hairstyle,
        headwear: a.headwear,
        cloak: PALETTES.cloak[a.cloak],
        torso: outfit,
        sleeves: armor >= 2 ? "#aeb7b3" : outfit,
        legs: "#6f6152",
        boots: "#4a3e33",
        belt: "#5d4a36",
        coat: "#9aba7d",
        plate: "#c8d2ce",
        armor,
        weapon: player?.tools?.weapon || 0,
    };
}

export function lookKey(player) {
    const a = appearanceOf(player);
    return [a.skin, a.hair, a.hairstyle, a.headwear, a.cloak, a.outfit, player?.tools?.armor || 0, player?.tools?.weapon || 0].join("|");
}

export function buildSurvivor(player) {
    const model = figurize(buildHumanoid(survivorLook(player)));
    model.userData.kind = "survivor";
    return model;
}

/* ── Creatures ──────────────────────────────────────────────────────────── */

/*
 * Four-legged animals from one recipe: a barrel of a body with a deeper
 * chest, a neck pivot carrying the head and muzzle, and a tail.
 */
function buildQuadruped({ length, height, color, belly, head, tail, ears, snout = 1 }) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const legH = height * 0.5;
    const r = height * 0.2;
    const trunk = add(body, capsuleGeo(r, length * 0.62), color, 0, legH + r * 0.9, -length * 0.02);
    trunk.rotation.x = Math.PI / 2;
    add(body, sphereGeo(r * 1.18, 1, 1.05, 1.1), color, 0, legH + r * 1.0, length * 0.24);
    add(body, sphereGeo(r * 0.95, 1.05, 0.7, 1.6), belly, 0, legH + r * 0.45, length * 0.05);

    const legs = [];
    const lx = r * 0.62;
    const lz = length * 0.33;
    const thick = Math.max(0.035, length * 0.055);
    /* Front left, front right, back left, back right. */
    [[-lx, lz], [lx, lz], [-lx, -lz], [lx, -lz]].forEach(([x, z]) => {
        const leg = jointed(body, x, legH + r * 0.4, z, thick, legH * 0.5, legH * 0.42, darker(color, 0.85), darker(color, 0.65));
        add(leg.joint, sphereGeo(thick * 1.25, 1, 0.6, 1.5), darker(color, 0.5), 0, -legH * 0.45, thick * 0.6);
        legs.push(leg);
    });

    const neck = new THREE.Group();
    neck.position.set(0, legH + r * 1.5, length * 0.38);
    body.add(neck);
    add(neck, taperGeo(r * 0.7, r * 0.95, r * 1.6, 10), color, 0, r * 0.2, r * 0.3).rotation.x = 0.9;
    add(neck, sphereGeo(head * 0.5, 0.95, 0.85, 1.05), color, 0, head * 0.38, head * 0.5);
    const muzzle = add(neck, taperGeo(head * 0.17, head * 0.3, head * 0.62 * snout, 8), belly, 0, head * 0.28, head * (0.95 + 0.2 * snout));
    muzzle.rotation.x = Math.PI / 2;
    add(neck, sphereGeo(head * 0.09), "#1b1a1f", 0, head * 0.3, head * (1.25 + 0.35 * snout));
    /* Eyes glow, so a pack in the dark is a pair of sparks before it is a
       shape. */
    add(neck, sphereGeo(head * 0.075), "#ffe9a8", -head * 0.2, head * 0.5, head * 0.9, "fire", { unlit: true });
    add(neck, sphereGeo(head * 0.075), "#ffe9a8", head * 0.2, head * 0.5, head * 0.9, "fire", { unlit: true });
    if (ears === "pointed") {
        [-1, 1].forEach((side) => {
            add(neck, coneGeo(head * 0.14, head * 0.38, 4), color, side * head * 0.24, head * 0.82, head * 0.38).rotation.z = -side * 0.2;
        });
    } else if (ears === "round") {
        [-1, 1].forEach((side) => {
            const ear = add(neck, taperGeo(head * 0.2, head * 0.2, head * 0.05, 10), "#d39a96", side * head * 0.3, head * 0.75, head * 0.35);
            ear.rotation.x = Math.PI / 2;
        });
    }

    const tailPivot = new THREE.Group();
    tailPivot.position.set(0, legH + r * 1.3, -length * 0.42);
    tailPivot.rotation.x = -0.9;
    if (tail.bushy) {
        add(tailPivot, sphereGeo(tail.w, 1, tail.l / tail.w / 2, 1), tail.color ?? color, 0, -tail.l / 2, 0);
        add(tailPivot, coneGeo(tail.w * 0.8, tail.l * 0.3, 8), belly, 0, -tail.l * 0.95, 0).rotation.x = Math.PI;
    } else {
        add(tailPivot, taperGeo(tail.w * 0.4, tail.w, tail.l, 6), tail.color ?? color, 0, -tail.l / 2, 0);
    }
    body.add(tailPivot);
    root.userData.rig = { body, legs, neck, tail: tailPivot, quad: true };
    return root;
}

const CREATURES = {
    rat: () =>
        buildQuadruped({
            length: 0.66,
            height: 0.36,
            color: "#9c8a5f",
            belly: "#c9b78e",
            head: 0.26,
            tail: { w: 0.035, l: 0.55, color: "#d39a96" },
            ears: "round",
            snout: 1.3,
        }),
    wolf: () =>
        buildQuadruped({
            length: 1.1,
            height: 0.78,
            color: "#8e9bb8",
            belly: "#c8d1e0",
            head: 0.38,
            tail: { w: 0.1, l: 0.52, bushy: true },
            ears: "pointed",
            snout: 1.2,
        }),
    kobold: () => {
        const model = buildHumanoid({
            skin: "#d0705a",
            hair: "#7a3b2e",
            hairstyle: "shaved",
            headwear: "none",
            cloak: null,
            torso: "#8c5a3c",
            sleeves: "#d0705a",
            legs: "#d0705a",
            boots: "#6c3a2b",
            belt: "#4d3221",
            armor: 0,
            weapon: 1,
        });
        model.scale.setScalar(0.74);
        const { head, torso } = model.userData.rig;
        /* A lizard's snout, horns and a tail. */
        add(head, taperGeo(0.07, 0.13, 0.2, 8), "#e07a5f", 0, -0.04, 0.2).rotation.x = Math.PI / 2;
        add(head, sphereGeo(0.03), "#ffd27a", -0.08, 0.05, 0.17, "fire", { unlit: true });
        add(head, sphereGeo(0.03), "#ffd27a", 0.08, 0.05, 0.17, "fire", { unlit: true });
        add(head, coneGeo(0.05, 0.2, 5), "#efe2c0", -0.12, 0.2, -0.04).rotation.x = -0.5;
        add(head, coneGeo(0.05, 0.2, 5), "#efe2c0", 0.12, 0.2, -0.04).rotation.x = -0.5;
        add(torso, taperGeo(0.02, 0.09, 0.55, 6), "#d0705a", 0, -0.08, -0.32).rotation.x = -1.1;
        return model;
    },
    troll: () => {
        const model = buildHumanoid({
            skin: "#8f6fc2",
            hair: "#4b3a66",
            hairstyle: "long",
            headwear: "none",
            cloak: null,
            torso: "#5d4c74",
            sleeves: "#8f6fc2",
            legs: "#5d4c74",
            boots: "#3b2f4a",
            belt: "#6b5b3c",
            armor: 0,
            weapon: 0,
            bulk: 1.35,
        });
        model.scale.setScalar(1.4);
        const { armR, armL, head } = model.userData.rig;
        model.userData.hunch = 0.3;
        /* Long arms, a heavy brow, tusks and a club. */
        armL.top.scale.setScalar(1.2);
        armR.top.scale.setScalar(1.2);
        add(head, boxGeo(0.3, 0.06, 0.08), "#6f55a0", 0, 0.08, 0.15);
        add(head, sphereGeo(0.07, 1, 0.8, 1), "#a68ad1", 0, -0.03, 0.18);
        add(head, coneGeo(0.025, 0.09, 4), "#efe2c0", -0.06, -0.1, 0.16);
        add(head, coneGeo(0.025, 0.09, 4), "#efe2c0", 0.06, -0.1, 0.16);
        const club = new THREE.Group();
        club.position.set(0, -0.27, 0.04);
        club.rotation.x = Math.PI / 2.6;
        add(club, taperGeo(0.035, 0.05, 0.55, 6), 0x7b5a3a, 0, 0.2, 0, "timber");
        add(club, sphereGeo(0.13, 1, 1.4, 1), 0x8a6a46, 0, 0.55, 0, "timber");
        armR.joint.add(club);
        return model;
    },
};

export function buildCreature(kind) {
    const make = CREATURES[kind] || CREATURES.rat;
    const model = figurize(make());
    model.userData.kind = kind;
    return model;
}

/* ── Animation ──────────────────────────────────────────────────────────── */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => {
    const x = clamp01(v);
    return x * x * (3 - 2 * x);
};

/*
 * An attack in three beats, from `k` running 0 to 1 over the swing: draw back,
 * strike, settle. Returns how far into the wind-up and the strike it is, and
 * how much of the pose the attack owns (it hands back to walking as it ends).
 */
function attackBeats(k) {
    if (k < 0 || k >= 1) return null;
    return {
        wind: smooth(k / 0.32),
        strike: smooth((k - 0.32) / 0.2),
        weight: Math.min(smooth(k / 0.1), 1 - smooth((k - 0.6) / 0.4)),
    };
}

const mix = (a, b, t) => a + (b - a) * t;

function poseHumanoid(model, rig, { stride, moving: a, t, attack, hurt }) {
    const s = Math.sin(stride);
    const c = Math.cos(stride);
    const idle = 1 - a;
    const breath = Math.sin(t * 2.1);

    /* Legs: the leg swinging forward bends at the knee and lifts its foot. */
    rig.legL.top.rotation.x = -s * 0.62 * a;
    rig.legR.top.rotation.x = s * 0.62 * a;
    rig.legL.joint.rotation.x = Math.max(0, c) * 1.1 * a + 0.04;
    rig.legR.joint.rotation.x = Math.max(0, -c) * 1.1 * a + 0.04;

    /* The body rides highest as the legs pass, sways over the planted foot,
       leans into the walk and breathes when it stops. */
    rig.body.position.set(s * 0.03 * a, (Math.abs(c) * 0.07 - 0.02) * a + breath * 0.006 * idle, 0);
    rig.body.rotation.z = Math.sin(t * 0.55) * 0.02 * idle;
    let twist = s * 0.16 * a;
    let lean = 0.1 * a + (model.userData.hunch || 0) + breath * 0.015 * idle;
    rig.torso.rotation.z = -s * 0.03 * a;

    /* Arms swing against the legs, elbows softly bent. */
    let shoulderL = s * 0.55 * a;
    let shoulderR = -s * 0.55 * a;
    let elbowL = -(0.15 + a * (0.2 + 0.4 * Math.max(0, -s)));
    let elbowR = -(0.15 + a * (0.2 + 0.4 * Math.max(0, s)));
    rig.armL.top.rotation.z = -0.07 - breath * 0.015 * idle;
    rig.armR.top.rotation.z = 0.07 + breath * 0.015 * idle;

    let lunge = 0;
    const beats = attackBeats(attack);
    if (beats) {
        /* Right arm up and back over the shoulder, then down through the
           target with the hips behind it. */
        const raised = mix(-0.4, -3.3, beats.wind);
        const struck = mix(raised, -0.7, beats.strike);
        const w = beats.weight;
        shoulderR = mix(shoulderR, struck, w);
        elbowR = mix(elbowR, mix(-0.9, -0.1, beats.strike), w);
        shoulderL = mix(shoulderL, -0.55, w);
        elbowL = mix(elbowL, -0.9, w);
        twist = mix(twist, mix(-0.4, 0.35, beats.strike), w);
        lean = mix(lean, mix(-0.12, 0.28, beats.strike), w);
        lunge = mix(-0.05, 0.16, beats.strike) * w;
        rig.legL.top.rotation.x = mix(rig.legL.top.rotation.x, -0.45 * beats.strike, w);
        rig.legL.joint.rotation.x = mix(rig.legL.joint.rotation.x, 0.3 * beats.strike, w);
        rig.legR.top.rotation.x = mix(rig.legR.top.rotation.x, 0.3 * beats.strike, w);
    }

    /* Taking a hit: rock back, head snapping after. */
    lean -= hurt * 0.4;
    lunge -= hurt * 0.1;

    rig.torso.rotation.x = lean;
    rig.torso.rotation.y = twist;
    rig.body.position.z = lunge;
    rig.armL.top.rotation.x = shoulderL;
    rig.armR.top.rotation.x = shoulderR;
    rig.armL.joint.rotation.x = elbowL;
    rig.armR.joint.rotation.x = elbowR;

    /* The head keeps level through the walk and looks about when idle. */
    rig.neck.rotation.x = -lean * 0.6 - hurt * 0.35;
    rig.neck.rotation.y = -twist * 0.7 + (Math.sin(t * 0.37) + Math.sin(t * 0.71 + 1.3)) * 0.2 * idle;

    const cape = model.userData.cape;
    if (cape) cape.rotation.x = 0.12 + a * 0.4 + Math.abs(s) * 0.1 * a + Math.sin(t * 3) * 0.04 + hurt * 0.3;
}

function poseQuadruped(rig, { stride, moving: a, t, attack, hurt }) {
    const p = stride * 2;
    const s = Math.sin(p);
    const c = Math.cos(p);
    const idle = 1 - a;
    const [fl, fr, bl, br] = rig.legs;

    /* A trot: diagonal pairs move together, each knee folding as its foot
       comes forward. Hind legs bend the other way, at the hock. */
    fl.top.rotation.x = s * 0.6 * a;
    br.top.rotation.x = s * 0.6 * a;
    fr.top.rotation.x = -s * 0.6 * a;
    bl.top.rotation.x = -s * 0.6 * a;
    const liftA = Math.max(0, -c) * 1.0 * a;
    const liftB = Math.max(0, c) * 1.0 * a;
    fl.joint.rotation.x = liftA;
    fr.joint.rotation.x = liftB;
    br.joint.rotation.x = -liftA;
    bl.joint.rotation.x = -liftB;

    const breath = Math.sin(t * 3.2);
    rig.body.position.y = Math.abs(c) * 0.05 * a + breath * 0.006 * idle;
    rig.body.rotation.x = c * 0.04 * a;

    /* Head bobs against the gait; standing still it sniffs the ground and
       looks around. */
    const sniff = Math.pow(Math.max(0, Math.sin(t * 0.45)), 6) * 0.45 * idle;
    let neckX = -c * 0.08 * a + sniff + Math.sin(t * 2) * 0.03;
    let neckY = Math.sin(t * 0.6 + 0.8) * 0.35 * idle;
    let lunge = 0;

    const beats = attackBeats(attack);
    if (beats) {
        /* Rear back, then snap forward and bite down. */
        const w = beats.weight;
        neckX = mix(neckX, mix(-0.45, 0.45, beats.strike), w);
        neckY *= 1 - w;
        lunge = mix(-0.1, 0.3, beats.strike) * w;
        rig.body.rotation.x = mix(rig.body.rotation.x, mix(-0.12, 0.08, beats.strike), w);
    }
    lunge -= hurt * 0.12;

    rig.body.position.z = lunge;
    rig.neck.rotation.x = neckX - hurt * 0.3;
    rig.neck.rotation.y = neckY;
    rig.tail.rotation.x = -0.9 - 0.35 * a;
    rig.tail.rotation.z = a > 0.5 ? Math.sin(t * 13) * 0.3 : Math.sin(t * 3) * 0.35;
}

/*
 * One pose function for every rig. `stride` is a running phase advanced by
 * distance walked, so feet keep pace with the ground instead of a clock.
 * `attack` runs 0 to 1 through a swing (negative when not swinging), `down`
 * 0 to 1 as a figure falls, `hurt` 1 to 0 after a hit.
 */
export function pose(model, { stride, moving, t, attack = -1, down = 0, hurt = 0 }) {
    const rig = model.userData.rig;
    if (!rig) return;
    const args = { stride, moving: moving * (1 - down), t, attack: down > 0 ? -1 : attack, hurt };
    if (rig.quad) poseQuadruped(rig, args);
    else poseHumanoid(model, rig, args);

    model.rotation.z = hurt ? Math.sin(t * 40) * 0.06 * hurt : 0;
    if (down > 0) {
        /* Topple backwards and settle with a small bounce. */
        const fall = down < 0.7 ? smooth(down / 0.7) : 1 - Math.sin(((down - 0.7) / 0.3) * Math.PI) * 0.06;
        rig.body.rotation.x = -fall * (Math.PI / 2);
        rig.body.position.y = 0.14 * fall;
    } else {
        rig.body.rotation.x = rig.quad ? rig.body.rotation.x : 0;
    }
}

/* Swap a figure to solid white for the instant it is hit, and back. */
export function flashModel(model, on) {
    if (Boolean(model.userData.flashing) === on) return;
    model.userData.flashing = on;
    model.traverse((node) => {
        if (!node.isMesh) return;
        if (on) {
            node.userData.baseMaterial = node.material;
            node.material = hitFlash();
        } else if (node.userData.baseMaterial) {
            node.material = node.userData.baseMaterial;
        }
    });
}

export function disposeModel(model) {
    model.traverse((node) => {
        if (node.material && node.material.userData?.own) node.material.dispose();
    });
}

/* ── Things people build ───────────────────────────────────────────────── */

const TIMBER = "#a07850";
const TIMBER_DARK = "#7a5a3c";
const STONE = "#8f978f";

function cyl(rt, rb, h, seg, color, set, x, y, z, options) {
    return part(geo(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), material(color, set, options), x, y, z);
}

function flame(scale = 1) {
    const group = new THREE.Group();
    const outer = part(geo("flameOuter", () => new THREE.ConeGeometry(0.16, 0.42, 6)), ownMaterial("#ffb347", "fire", { unlit: true }), 0, 0.21, 0, false);
    const inner = part(geo("flameInner", () => new THREE.ConeGeometry(0.08, 0.26, 5)), ownMaterial("#fff1b8", "fire", { unlit: true }), 0, 0.14, 0, false);
    outer.material.userData.own = true;
    inner.material.userData.own = true;
    group.add(outer, inner);
    group.scale.setScalar(scale);
    group.userData.flame = true;
    return group;
}

/*
 * Each builder returns a group sitting on the ground at the origin of its
 * tile. `cell` is the server's record, so doors know if they are open and
 * campfires whether they are lit.
 */
const STRUCTURE_BUILDERS = {
    /* Half-timbered, as in an old Slavic town: a stone footing, white
       plaster between dark posts and braces, and a little tiled ridge. */
    wall: () => {
        const g = new THREE.Group();
        g.add(box(1, 0.3, 1, STONE, "rock", 0, 0.15, 0));
        g.add(box(0.9, 1.6, 0.9, "#e4dfd2", "solid", 0, 1.1, 0));
        [-0.44, 0.44].forEach((x) => [-0.44, 0.44].forEach((z) => g.add(box(0.12, 1.6, 0.12, TIMBER_DARK, "timber", x, 1.1, z))));
        g.add(box(1.0, 0.12, 1.0, TIMBER_DARK, "timber", 0, 1.1, 0));
        g.add(box(1.0, 0.12, 1.0, TIMBER_DARK, "timber", 0, 1.9, 0));
        g.add(part(geo("wallRidge", () => new THREE.ConeGeometry(0.72, 0.55, 4).rotateY(Math.PI / 4)), material("#9c4b3c", "rock"), 0, 2.23, 0));
        return g;
    },
    floor: (cell, ctx) => {
        const g = new THREE.Group();
        if (ctx.overWater) {
            for (let i = -2; i <= 2; i += 1) g.add(box(0.98, 0.07, 0.17, TIMBER, "timber", 0, ctx.deck, i * 0.2));
            g.add(box(0.08, 0.5, 0.08, TIMBER_DARK, "timber", -0.45, ctx.deck - 0.22, -0.45));
            g.add(box(0.08, 0.5, 0.08, TIMBER_DARK, "timber", 0.45, ctx.deck - 0.22, 0.45));
        } else {
            g.add(box(0.94, 0.06, 0.94, "#a8b2a1", "path", 0, 0.03, 0));
        }
        return g;
    },
    door: (cell) => {
        const g = new THREE.Group();
        /* Tall timber posts and a gate under a little tent roof. */
        g.add(box(0.16, 2.0, 0.4, TIMBER_DARK, "timber", -0.42, 1.0, 0));
        g.add(box(0.16, 2.0, 0.4, TIMBER_DARK, "timber", 0.42, 1.0, 0));
        g.add(box(1.0, 0.24, 0.42, TIMBER_DARK, "timber", 0, 2.0, 0));
        g.add(part(geo("gateRoof", () => new THREE.ConeGeometry(0.62, 0.7, 4).rotateY(Math.PI / 4)), material("#9c4b3c", "rock"), 0, 2.47, 0));
        const hinge = new THREE.Group();
        hinge.position.set(-0.34, 0, 0);
        hinge.add(box(0.68, 1.72, 0.08, "#dec091", "timber", 0.34, 0.88, 0));
        hinge.add(box(0.06, 0.06, 0.06, "#3a3a3a", "solid", 0.6, 0.9, 0.06));
        g.add(hinge);
        g.userData.hinge = hinge;
        g.userData.open = cell.open ? 1 : 0;
        return g;
    },
    torch: () => {
        const g = new THREE.Group();
        g.add(box(0.1, 0.95, 0.1, TIMBER_DARK, "timber", 0, 0.47, 0));
        g.add(box(0.16, 0.12, 0.16, "#5a4632", "timber", 0, 0.98, 0));
        const f = flame(0.7);
        f.position.y = 1.02;
        g.add(f);
        g.userData.light = { y: 1.3, range: 6, color: 0xffb46b };
        return g;
    },
    sign: () => {
        const g = new THREE.Group();
        g.add(box(0.1, 0.9, 0.1, TIMBER_DARK, "timber", 0, 0.45, 0));
        g.add(box(0.76, 0.44, 0.07, "#cbbb91", "timber", 0, 0.9, 0.05));
        g.add(box(0.5, 0.04, 0.02, "#5a4632", "solid", 0, 0.96, 0.095));
        g.add(box(0.4, 0.04, 0.02, "#5a4632", "solid", 0, 0.86, 0.095));
        return g;
    },
    campfire: (cell, ctx) => {
        const g = new THREE.Group();
        for (let i = 0; i < 7; i += 1) {
            const a = (i / 7) * Math.PI * 2;
            g.add(part(geo("pebble", () => new THREE.DodecahedronGeometry(0.11)), material(STONE, "rock"), Math.cos(a) * 0.36, 0.07, Math.sin(a) * 0.36));
        }
        const logA = box(0.12, 0.12, 0.6, TIMBER_DARK, "timber", 0, 0.1, 0);
        logA.rotation.y = 0.7;
        const logB = box(0.12, 0.12, 0.6, TIMBER_DARK, "timber", 0, 0.14, 0);
        logB.rotation.y = -0.7;
        g.add(logA, logB);
        if (ctx.lit) {
            const f = flame(1.25);
            f.position.y = 0.1;
            g.add(f);
            g.userData.light = { y: 0.8, range: 9, color: 0xff9c4a };
        } else {
            g.add(box(0.3, 0.05, 0.3, "#55554a", "path", 0, 0.05, 0));
        }
        return g;
    },
    workbench: () => {
        const g = new THREE.Group();
        g.add(box(0.96, 0.12, 0.66, "#c7ac82", "timber", 0, 0.72, 0));
        [[-0.4, -0.25], [0.4, -0.25], [-0.4, 0.25], [0.4, 0.25]].forEach(([x, z]) => g.add(box(0.1, 0.66, 0.1, TIMBER_DARK, "timber", x, 0.33, z)));
        g.add(box(0.3, 0.06, 0.06, "#9aa3a0", "solid", 0.15, 0.81, 0.1));
        g.add(box(0.12, 0.12, 0.12, "#7b6a55", "solid", -0.25, 0.84, -0.1));
        return g;
    },
    furnace: () => {
        const g = new THREE.Group();
        g.add(box(0.9, 0.8, 0.9, "#8a8178", "rock", 0, 0.4, 0));
        g.add(cyl(0.3, 0.42, 0.4, 8, "#8a8178", "rock", 0, 1.0, 0));
        g.add(box(0.2, 0.5, 0.2, "#6f675f", "rock", 0.24, 1.3, -0.2));
        g.add(box(0.4, 0.3, 0.04, "#ff9a4d", "fire", 0, 0.3, 0.46, { unlit: true }));
        g.userData.light = { y: 0.5, range: 3, color: 0xff8a3d };
        return g;
    },
    bedroll: () => {
        const g = new THREE.Group();
        g.add(box(0.6, 0.12, 0.9, "#b1ba85", "grass", 0, 0.06, 0.02));
        g.add(box(0.62, 0.14, 0.24, "#8c9468", "grass", 0, 0.08, -0.32));
        g.add(box(0.36, 0.12, 0.2, "#e6dcc0", "solid", 0, 0.16, -0.34));
        return g;
    },
    chest: () => {
        const g = new THREE.Group();
        g.add(box(0.76, 0.46, 0.5, "#b0874f", "timber", 0, 0.23, 0));
        g.add(box(0.8, 0.16, 0.54, "#d1b889", "timber", 0, 0.54, 0));
        g.add(box(0.8, 0.06, 0.55, "#7a7a72", "solid", 0, 0.36, 0));
        g.add(box(0.1, 0.12, 0.04, "#e3c25f", "fire", 0, 0.4, 0.27));
        return g;
    },
    stump: () => {
        const g = new THREE.Group();
        g.add(cyl(0.2, 0.26, 0.24, 7, TIMBER_DARK, "timber", 0, 0.12, 0));
        g.add(cyl(0.19, 0.19, 0.02, 7, "#c9a77b", "timber", 0, 0.25, 0));
        return g;
    },
    rubble: () => {
        const g = new THREE.Group();
        [[0.15, 0.1, 0.12], [-0.18, -0.1, 0.1], [0.02, 0.2, 0.08]].forEach(([x, z, r]) =>
            g.add(part(geo(`rubble${r}`, () => new THREE.DodecahedronGeometry(r)), material(STONE, "rock"), x, r * 0.6, z)),
        );
        return g;
    },
};

export function structureKey(cell, ctx) {
    return `${cell.kind}|${ctx.lit ? 1 : 0}|${ctx.overWater ? 1 : 0}`;
}

export function buildStructure(cell, ctx) {
    const make = STRUCTURE_BUILDERS[cell.kind];
    if (!make) return null;
    const group = make(cell, ctx);
    group.userData.kind = cell.kind;
    return group;
}

/* The selection marker: four corner brackets around the aimed tile. Kept
   light, because at close zoom a full box dwarfs the person aiming it. */
export function buildCursor() {
    const g = new THREE.Group();
    const m = ownMaterial("#f3e6bd", "solid", { unlit: true });
    const t = 0.05;
    const arm = 0.26;
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([sx, sz]) => {
        g.add(part(boxGeo(arm, 0.04, t), m, sx * (0.5 - arm / 2), 0.02, sz * 0.48, false));
        g.add(part(boxGeo(t, 0.04, arm), m, sx * 0.48, 0.02, sz * (0.5 - arm / 2), false));
    });
    return g;
}

import * as THREE from "three";
import { material, ownMaterial, asFigure, hitFlash } from "./materials";
import { glyphCode, GLYPH_SETS } from "./asciiPass";
import { humanoidSpec, quadrupedSpec, koboldSpec, trollSpec, QUADRUPEDS, seedOf } from "./figureKit";
import { buildFigure } from "./figureGeometry";
import { PALETTES, appearanceOf } from "../../lib/appearance";

/*
 * The people, creatures and buildings of the Commons, as real low-poly models.
 *
 * Everything is built from boxes, cones and spheres at load. Each figure is a
 * hierarchy of pivots — hips, knees, ankles, shoulders, elbows, wrists, neck,
 * jaw, tail — so walking is a matter of bending limbs about their joints, not
 * swapping sprites. People and animals are recipes in figureKit.js, built by
 * figureGeometry.js into one vertex-coloured mesh per pivot and glyph set;
 * this file supplies the materials, the registry of kinds and the posing.
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

/* Rounded parts for things added to a figure after it is built (a club, a
   shade's eyes). Geometry is cached: a crowd shares one of each. */
const sphereGeo = (r, sx = 1, sy = 1, sz = 1) =>
    geo(`sph${r},${sx},${sy},${sz}`, () => new THREE.SphereGeometry(r, 10, 7).scale(sx, sy, sz));
const taperGeo = (rt, rb, h, seg = 10, sz = 1) =>
    geo(`tap${rt},${rb},${h},${seg},${sz}`, () => new THREE.CylinderGeometry(rt, rb, h, seg).scale(1, 1, sz));
const coneGeo = (r, h, seg = 8) => geo(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));

function add(parent, geometry, color, x, y, z, set = "solid", options) {
    const mesh = part(geometry, material(color, set, options), x, y, z);
    parent.add(mesh);
    return mesh;
}

/* People and creatures draw in the figure set; see asciiPass.js. */
function figurize(root) {
    root.traverse((node) => {
        if (node.isMesh) node.material = asFigure(node.material);
    });
    return root;
}

/*
 * The material for a figure's merged parts: colour from the vertices, and
 * the same faint glow from within that every plain model has (see
 * materials.js), so a figure in its own shadow still reads as a figure.
 * Plain parts draw in the figure set; parts that chose a set keep it.
 */
const figureMaterials = new Map();
function figureMaterial({ set, unlit }) {
    const key = `${set}|${unlit ? 1 : 0}`;
    let made = figureMaterials.get(key);
    if (made) return made;
    const common = {
        vertexColors: true,
        blending: THREE.NoBlending,
        transparent: false,
        opacity: glyphCode(GLYPH_SETS[set === "solid" ? "figure" : set] ?? 0),
    };
    if (unlit) {
        made = new THREE.MeshBasicMaterial(common);
    } else {
        made = new THREE.MeshLambertMaterial(common);
        made.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <emissivemap_fragment>",
                "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * 0.22;",
            );
        };
        made.customProgramCacheKey = () => "commons-figure";
    }
    figureMaterials.set(key, made);
    return made;
}

/* ── People ─────────────────────────────────────────────────────────────── */

/*
 * A survivor, about 1.7 tiles tall with a slightly large head, so a face
 * still reads when the whole figure is a dozen characters high. The recipe
 * is humanoidSpec(); the rig keeps the names posing has always used.
 */
function humanoidModel(spec) {
    const { root: body, pivots: p } = buildFigure(spec, figureMaterial);
    const model = new THREE.Group();
    model.add(body);
    const limb = (top, joint, end) => ({ top: p[top], joint: p[joint], end: p[end] });
    model.userData.rig = {
        body,
        torso: p.torso,
        legL: limb("hipL", "kneeL", "ankleL"),
        legR: limb("hipR", "kneeR", "ankleR"),
        armL: limb("shoulderL", "elbowL", "handL"),
        armR: limb("shoulderR", "elbowR", "handR"),
        neck: p.neck,
        head: p.head,
        eyes: p.eyes,
        tail: p.tail,
        tailTip: p.tailTip,
    };
    if (p.cape) model.userData.cape = p.cape;
    /* Where in its blink cycle this figure is, so a crowd does not blink as one. */
    model.userData.seed = seedOf(spec.parts.map((p) => p.color).join());
    return model;
}

function buildHumanoid(look) {
    return humanoidModel(humanoidSpec(look));
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

/* Four-legged animals; the recipe is quadrupedSpec(). */
function buildQuadruped(options) {
    const spec = quadrupedSpec(options);
    const { root: body, pivots: p } = buildFigure(spec, figureMaterial);
    const model = new THREE.Group();
    model.add(body);
    model.userData.rig = {
        body,
        legs: spec.legs.map((name) => ({ top: p[`leg${name}`], joint: p[`knee${name}`] })),
        neck: p.neck,
        jaw: p.jaw,
        tail: p.tail,
        tailTip: p.tailTip,
        quad: true,
    };
    model.userData.seed = seedOf(JSON.stringify(options));
    return model;
}

const CREATURES = {
    rat: () => buildQuadruped(QUADRUPEDS.rat),
    wolf: () => buildQuadruped(QUADRUPEDS.wolf),
    kobold: () => {
        const model = humanoidModel(koboldSpec());
        model.scale.setScalar(0.74);
        return model;
    },
    troll: () => {
        const model = humanoidModel(trollSpec());
        model.scale.setScalar(1.4);
        const { armR, armL } = model.userData.rig;
        model.userData.hunch = 0.3;
        /* Long arms, and a club studded with bone. */
        armL.top.scale.setScalar(1.2);
        armR.top.scale.setScalar(1.2);
        const club = new THREE.Group();
        club.position.set(0, -0.27, 0.04);
        club.rotation.x = Math.PI / 2.6;
        add(club, taperGeo(0.035, 0.05, 0.55, 6), 0x7b5a3a, 0, 0.2, 0, "timber");
        add(club, sphereGeo(0.13, 1, 1.4, 1), 0x8a6a46, 0, 0.55, 0, "timber");
        for (let i = 0; i < 6; i += 1) {
            const a = (i / 6) * Math.PI * 2;
            const y = 0.5 + (i % 2) * 0.12;
            add(club, coneGeo(0.03, 0.1, 4), "#efe2c0", Math.cos(a) * 0.13, y, Math.sin(a) * 0.13).rotation.set(Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4);
        }
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

    /* Feet stay near level through the stride and push off at the toe. */
    [rig.legL, rig.legR].forEach((leg) => {
        if (leg.end) leg.end.rotation.x = -(leg.top.rotation.x + leg.joint.rotation.x) * 0.75;
    });
    /* A blink every few seconds, each figure on its own beat. */
    if (rig.eyes) rig.eyes.scale.y = blinking(t, model.userData.seed) ? 0.15 : 1;
    /* A tail swings against the hips and follows through at the tip. */
    if (rig.tail) {
        rig.tail.rotation.z = s * 0.35 * a + Math.sin(t * 1.3) * 0.15 * idle;
        if (rig.tailTip) rig.tailTip.rotation.z = Math.sin(stride - 0.8) * 0.4 * a + Math.sin(t * 1.3 - 0.7) * 0.2 * idle;
    }
}

function blinking(t, seed = 0) {
    const cycle = 3.7 + seed * 2.2;
    return (t + seed * 10) % cycle < 0.13;
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
    if (rig.tailTip) {
        /* The tip lags the root, so the tail curls instead of swinging stiff. */
        rig.tailTip.rotation.x = 0.25 + 0.2 * a;
        rig.tailTip.rotation.z = a > 0.5 ? Math.sin(t * 13 - 1) * 0.35 : Math.sin(t * 3 - 1) * 0.4;
    }
    if (rig.jaw) {
        /* Panting at a run, a slow breath at rest, and jaws wide for the bite. */
        let open = a * (0.12 + Math.sin(t * 9) * 0.06) + idle * (0.04 + Math.sin(t * 1.6) * 0.03);
        if (beats) open = mix(open, mix(0.15, 0.7, beats.wind) * (1 - beats.strike), beats.weight);
        rig.jaw.rotation.x = Math.max(0, open) + hurt * 0.3;
    }
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

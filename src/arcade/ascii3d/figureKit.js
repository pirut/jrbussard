/*
 * What the people and creatures of the Commons are made of, as plain data.
 *
 * Nothing here imports three.js or touches a scene, so the React Native app
 * can read the same recipes. A spec is a list of pivots (the joints posing
 * turns) and a list of parts hung off them:
 *
 *   pivot  { name, parent, at: [x, y, z], rot?: [x, y, z] }
 *   part   { on, shape: [kind, ...args], color, at, rot?, scale?, set?, unlit? }
 *
 * Shape kinds: box(w, h, d), sphere(r, sx, sy, sz), capsule(r, length),
 * taper(rTop, rBottom, h, segments, depthScale), dome(r, sx, sy, sz, cut),
 * cone(r, h, segments) and cape(). figureGeometry.js builds them.
 *
 * Coordinates: one tile is one unit, y is up, a figure faces +z. Parts are
 * chunky on purpose: at a few characters per limb a thin arm vanishes, so
 * detail goes where it changes the outline or the shading ramp (a jaw, a
 * pauldron, a ruff) rather than into things smaller than a character cell.
 *
 * Callers: models.js (the registry that turns these into rigs and poses
 * them) and tests/models.test.ts. Specs are deterministic and structured-
 * cloneable (the tests pin both), so keep them free of Math.random, Dates
 * and functions. This file does not build geometry (figureGeometry.js),
 * pick materials (materials.js) or animate (models.js `pose`).
 *
 * What must stay in sync: the pivot names are the rig contract with
 * models.js (hipL/kneeL/ankleL, shoulderL/elbowL/handL and their R twins,
 * torso, neck, head, eyes, cape, held, tail/tailTip; legFL.. / kneeFL.. /
 * jaw for quadrupeds). Rename one here and `poseHumanoid` / `poseQuadruped`
 * silently stop moving it. Colours are "#rrggbb" strings (the tests check
 * that), and `set` names a glyph set from asciiPass.js GLYPH_SETS.
 */

/* ── Colour ─────────────────────────────────────────────────────────────── */

/* 0..255 channels from "#rrggbb" or a number. A three-digit "#rgb" is not
   expanded: it would be read as 0x000rgb, so always write six digits. */
function channels(hex) {
    const n = typeof hex === "number" ? hex : parseInt(String(hex).replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
}

/* A colour made darker (k < 1) or lighter (k > 1). */
export function shade(hex, k) {
    return toHex(channels(hex).map((v) => v * k));
}

/* A colour `t` of the way (0..1) from a to b, mixed per sRGB channel. */
export function mixColor(a, b, t) {
    const ca = channels(a);
    const cb = channels(b);
    return toHex(ca.map((v, i) => v + (cb[i] - v) * t));
}

/* A small, stable number in [0, 1) from a string (32-bit FNV-1a, reduced
   to ten-thousandths), for per-figure variation such as the blink phase
   in models.js. Same text, same number, on every device. */
export function seedOf(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return ((h >>> 0) % 10000) / 10000;
}

/* ── Building a spec ────────────────────────────────────────────────────── */

/* The builder a *Spec function fills in: pivot(name, parent, at, rot?) and
   part(on, shape, color, at, extra?) where `extra` is the optional part
   fields (rot, scale, set, unlit). Pivot positions are relative to their
   parent; part positions relative to the pivot named by `on`. */
function recipe() {
    const pivots = [];
    const parts = [];
    return {
        pivots,
        parts,
        pivot(name, parent, at, rot) {
            pivots.push(rot ? { name, parent, at, rot } : { name, parent, at });
        },
        part(on, shape, color, at, extra) {
            parts.push({ on, shape, color, at, ...extra });
        },
    };
}

/* What a recipe hands out: its data only, safe to clone, store or send.
   `legs` (quadrupeds only) lists the leg name suffixes that models.js turns
   into leg{name}/knee{name} pivot pairs. */
function finished({ pivots, parts, legs }) {
    return legs ? { pivots, parts, legs } : { pivots, parts };
}

/* Colours shared across recipes: trim and buckles, eyes/nostrils, teeth
   and horns. */
const GOLD = "#c9b27a";
const INK = "#1b1a1f";
const BONE = "#efe2c0";

/* ── People ─────────────────────────────────────────────────────────────── */

/*
 * A survivor, about 1.7 tiles tall with a slightly large head, so a face
 * still reads when the whole figure is a dozen characters high.
 *
 * `look` holds colours (skin, hair, torso, sleeves, legs, boots, belt, coat,
 * plate, cloak), styles (hairstyle, headwear), armor and weapon tiers, and
 * bulk, which widens everything for a troll.
 *
 * armor: 0 none, 1 padded coat, >= 2 plate. weapon: 0 none, 1 spear,
 * >= 2 sword (both hang off the "held" pivot on the right hand). `look` is
 * built by models.js survivorLook() for players and written out in full for
 * kobold, troll and shade below. `bulk` widens radii and limb offsets
 * (the pivot heights and limb lengths stay put).
 */
export function humanoidSpec(look) {
    return finished(humanoidRecipe(look));
}

/* The recipe itself, separate from humanoidSpec so that koboldSpec and
   trollSpec can add parts and pivots before it is finished. */
function humanoidRecipe(look) {
    const r = recipe();
    const { part, pivot } = r;
    const b = look.bulk || 1;
    const skin = look.skin;
    const hair = look.hair;
    const legs = look.legs;
    const boots = look.boots;

    pivot("body", null, [0, 0, 0]);

    /* Legs from the hip, a knee, and an ankle so a foot can stay flat as
       the leg swings. Trousers tuck into boots with a turned-down cuff. */
    [["L", -1], ["R", 1]].forEach(([s, sx]) => {
        pivot(`hip${s}`, "body", [sx * 0.1, 0.66, 0]);
        pivot(`knee${s}`, `hip${s}`, [0, -0.3, 0]);
        pivot(`ankle${s}`, `knee${s}`, [0, -0.26, 0]);
        part(`hip${s}`, ["capsule", 0.075 * b, 0.3], legs, [0, -0.15, 0]);
        part(`knee${s}`, ["capsule", 0.066 * b, 0.26], legs, [0, -0.12, 0]);
        part(`knee${s}`, ["taper", 0.085, 0.09, 0.16, 8], boots, [0, -0.19, 0]);
        part(`knee${s}`, ["taper", 0.097, 0.092, 0.045, 8], shade(boots, 1.25), [0, -0.1, 0]);
        part(`ankle${s}`, ["sphere", 0.09, 1, 0.6, 1.5], boots, [0, -0.04, 0.05]);
        part(`ankle${s}`, ["box", 0.15, 0.03, 0.27], shade(boots, 0.62), [0, -0.085, 0.05]);
        if (look.armor >= 2) {
            part(`knee${s}`, ["taper", 0.08 * b, 0.074 * b, 0.15, 8], look.plate, [0, -0.06, 0.005]);
            part(`knee${s}`, ["sphere", 0.06, 1, 0.9, 0.8], shade(look.plate, 1.08), [0, 0.01, 0.04]);
        }
    });

    /* Pelvis, a chest that narrows to the waist, a belt with a buckle and
       a pouch, a collar and the line of buttons down the front. */
    pivot("torso", "body", [0, 0.66, 0]);
    const torso = look.torso;
    part("torso", ["taper", 0.17 * b, 0.16 * b, 0.14, 10, 0.7], legs, [0, 0, 0]);
    part("torso", ["taper", 0.23 * b, 0.17 * b, 0.42, 10, 0.68], torso, [0, 0.27, 0]);
    part("torso", ["taper", 0.11 * b, 0.15 * b, 0.06, 10, 0.8], shade(torso, 0.74), [0, 0.47, 0]);
    part("torso", ["box", 0.026, 0.3, 0.02], shade(torso, 0.7), [0, 0.27, 0.137 * b], { rot: [0.095, 0, 0] });
    part("torso", ["taper", 0.176 * b, 0.176 * b, 0.06, 10, 0.72], look.belt, [0, 0.07, 0]);
    part("torso", ["box", 0.06, 0.05, 0.02], GOLD, [0, 0.07, 0.127 * b]);
    part("torso", ["box", 0.08, 0.09, 0.05], shade(look.belt, 1.2), [0.13 * b, 0.02, 0.085 * b], { rot: [0, 0.6, 0] });

    if (look.armor >= 2) {
        /* Plate: a ridged breastplate, a gorget, layered pauldrons and
           tassets over the hips. */
        const plate = look.plate;
        part("torso", ["taper", 0.245 * b, 0.19 * b, 0.3, 10, 0.72], plate, [0, 0.33, 0]);
        part("torso", ["box", 0.03, 0.28, 0.03], shade(plate, 1.12), [0, 0.33, 0.165 * b], { rot: [0.1, 0, 0] });
        part("torso", ["taper", 0.12, 0.17 * b, 0.08, 10, 0.85], shade(plate, 0.82), [0, 0.49, 0]);
        [-1, 1].forEach((sx) => {
            part("torso", ["dome", 0.13 * b, 1, 0.8, 1], plate, [sx * 0.25 * b, 0.45, 0]);
            part("torso", ["dome", 0.11 * b, 1, 0.7, 1], shade(plate, 0.84), [sx * 0.27 * b, 0.38, 0]);
            part("torso", ["box", 0.13, 0.15, 0.03], plate, [sx * 0.08 * b, -0.05, 0.13 * b], { rot: [-0.2, 0, 0] });
        });
    } else if (look.armor === 1) {
        /* A padded coat that flares into a short skirt, quilted in bands. */
        const coat = look.coat;
        part("torso", ["taper", 0.24 * b, 0.19 * b, 0.34, 10, 0.72], coat, [0, 0.3, 0], { set: "grass" });
        part("torso", ["taper", 0.19 * b, 0.25 * b, 0.22, 10, 0.78], coat, [0, -0.05, 0], { set: "grass" });
        part("torso", ["taper", 0.212 * b, 0.212 * b, 0.025, 10, 0.74], shade(coat, 0.72), [0, 0.22, 0], { set: "grass" });
        part("torso", ["taper", 0.234 * b, 0.234 * b, 0.025, 10, 0.74], shade(coat, 0.72), [0, 0.36, 0], { set: "grass" });
        part("torso", ["taper", 0.13 * b, 0.2 * b, 0.08, 10, 0.8], shade(coat, 0.86), [0, 0.48, 0], { set: "grass" });
    }

    /* Arms: a rounded shoulder, a cuffed sleeve, a wrist that carries the
       hand and whatever it holds. */
    const sleeves = look.sleeves;
    [["L", -1], ["R", 1]].forEach(([s, sx]) => {
        pivot(`shoulder${s}`, "torso", [sx * 0.24 * b, 0.44, 0]);
        pivot(`elbow${s}`, `shoulder${s}`, [0, -0.22, 0]);
        pivot(`hand${s}`, `elbow${s}`, [0, -0.24, 0.01]);
        part(`shoulder${s}`, ["sphere", 0.08 * b, 1, 1, 1], sleeves, [0, 0, 0]);
        part(`shoulder${s}`, ["capsule", 0.062 * b, 0.22], sleeves, [0, -0.11, 0]);
        part(`elbow${s}`, ["capsule", 0.055 * b, 0.2], sleeves, [0, -0.1, 0]);
        part(`elbow${s}`, ["taper", 0.066 * b, 0.064 * b, 0.045, 8], shade(sleeves, 0.74), [0, -0.19, 0]);
        if (look.armor === 1) part(`elbow${s}`, ["taper", 0.07 * b, 0.064 * b, 0.1, 8], "#7a5a3c", [0, -0.12, 0]);
        part(`hand${s}`, ["sphere", 0.062 * b, 1, 1.1, 1], skin, [0, -0.03, 0]);
        part(`hand${s}`, ["sphere", 0.026 * b, 1, 1.4, 1], skin, [-sx * 0.045 * b, -0.015, 0.03]);
    });

    if (look.cloak) {
        /* A cape that flares toward a darker hem, pinned at the collar. */
        const cloak = look.cloak;
        pivot("cape", "torso", [0, 0.47, -0.12]);
        part("cape", ["cape"], cloak, [0, -0.4, 0]);
        part("cape", ["taper", 0.15, 0.2, 0.05, 10, 0.75], cloak, [0, -0.005, 0.1]);
        part("cape", ["box", 0.6, 0.045, 0.05], shade(cloak, 0.68), [0, -0.78, -0.075]);
        [-1, 1].forEach((sx) => part("cape", ["sphere", 0.032, 1, 1, 1], GOLD, [sx * 0.13, -0.01, 0.17]));
    }
    if (look.headwear === "hood") {
        /* The hood's mantle lies over the shoulders. */
        part("torso", ["taper", 0.16, 0.27 * b, 0.12, 12, 0.8], look.cloak || torso, [0, 0.45, -0.01]);
    }

    /* The head: a skull, a jaw that gives it a chin, ears, a nose that
       catches light, a mouth, brows, and eyes on their own pivot so they
       can blink. Eyes, brows and nose give the head a front, which is most
       of what makes a lump of characters a person. */
    pivot("neck", "torso", [0, 0.48, 0]);
    pivot("head", "neck", [0, 0.2, 0]);
    pivot("eyes", "head", [0, 0.015, 0.165]);
    part("neck", ["taper", 0.06, 0.07, 0.1, 8], skin, [0, 0.03, 0]);
    part("head", ["sphere", 0.19, 0.95, 1.05, 1], skin, [0, 0, 0]);
    part("head", ["sphere", 0.15, 1, 0.7, 0.9], skin, [0, -0.08, 0.03]);
    [-1, 1].forEach((sx) => {
        part("head", ["sphere", 0.04, 0.6, 1, 1], skin, [sx * 0.185, 0, 0]);
        part("head", ["box", 0.08, 0.022, 0.025], shade(hair, 0.8), [sx * 0.07, 0.075, 0.168], { rot: [0, 0, -sx * 0.12] });
    });
    part("head", ["cone", 0.03, 0.08, 6], shade(skin, 0.9), [0, -0.03, 0.19], { rot: [Math.PI / 2, 0, 0] });
    part("head", ["box", 0.07, 0.016, 0.02], shade(skin, 0.58), [0, -0.1, 0.162]);
    if (look.glowEyes) {
        /* Something not human looks out with eyes that light. */
        [-1, 1].forEach((sx) => part("eyes", ["sphere", 0.032, 1, 1.1, 0.7], look.glowEyes, [sx * 0.08, 0.035, 0.005], { set: "fire", unlit: true }));
    } else if (look.headwear === "hood") {
        /* Under a hood only two glints of eye show. */
        [-1, 1].forEach((sx) => part("eyes", ["sphere", 0.03, 1, 1.2, 0.6], "#e8e2cf", [sx * 0.06, -0.005, 0.005]));
    } else {
        [-1, 1].forEach((sx) => {
            part("eyes", ["sphere", 0.042, 1.2, 1, 0.5], "#eee6d6", [sx * 0.068, 0, -0.008]);
            part("eyes", ["sphere", 0.032, 1, 1.2, 0.6], INK, [sx * 0.068, 0, 0]);
        });
    }
    hairParts(r, look);
    headwearParts(r, look);

    if (look.weapon) {
        pivot("held", "handR", [0, -0.03, 0.02], [Math.PI / 2.4, 0, 0]);
        if (look.weapon >= 2) {
            /* A sword: wrapped grip, pommel, a guard with knobs, a blade
               with a fuller and a point. */
            part("held", ["taper", 0.025, 0.025, 0.14, 6], "#5a4632", [0, 0, 0]);
            part("held", ["sphere", 0.04, 1, 1, 1], GOLD, [0, -0.09, 0]);
            part("held", ["box", 0.26, 0.035, 0.05], "#9c7a4d", [0, 0.08, 0]);
            [-1, 1].forEach((sx) => part("held", ["sphere", 0.03, 1, 1, 1], GOLD, [sx * 0.13, 0.08, 0]));
            part("held", ["box", 0.07, 0.58, 0.022], "#dfe4de", [0, 0.39, 0]);
            part("held", ["box", 0.018, 0.48, 0.028], "#a9b2ad", [0, 0.36, 0]);
            part("held", ["cone", 0.05, 0.12, 4], "#dfe4de", [0, 0.74, 0], { scale: [1, 1, 0.3] });
        } else {
            /* A spear: an ash shaft, bindings, a socketed leaf head and a
               rag tied below it. */
            part("held", ["taper", 0.024, 0.028, 1.1, 6], "#9c7a4d", [0, 0.3, 0], { set: "timber" });
            part("held", ["taper", 0.032, 0.032, 0.05, 6], "#5d4a36", [0, 0.78, 0]);
            part("held", ["taper", 0.032, 0.032, 0.05, 6], "#5d4a36", [0, -0.1, 0]);
            part("held", ["taper", 0.028, 0.036, 0.08, 6], "#8a8f8a", [0, 0.84, 0], { set: "rock" });
            part("held", ["cone", 0.06, 0.26, 4], "#b0b9b2", [0, 1.0, 0], { set: "rock", scale: [1, 1, 0.45] });
            part("held", ["box", 0.12, 0.05, 0.01], look.cloak || "#a33d3d", [0.065, 0.74, 0], { rot: [0, 0, -0.3] });
        }
    }
    return r;
}

/* Hair for look.hairstyle: "long", "braids", "shaved", else cropped. Skipped
   under a hood, which hides it. Positions are on the "head" pivot. */
function hairParts({ part }, look) {
    const hair = look.hair;
    if (look.headwear === "hood") return;
    const cap = () => part("head", ["dome", 0.205, 1, 1.05, 1.05], hair, [0, 0.01, -0.01]);
    switch (look.hairstyle) {
        case "long":
            /* Falls past the shoulders, with locks framing the face. */
            cap();
            part("head", ["taper", 0.18, 0.15, 0.42, 10, 0.55], hair, [0, -0.15, -0.1]);
            [-1, 1].forEach((sx) => part("head", ["capsule", 0.045, 0.22], hair, [sx * 0.17, -0.1, 0.03]));
            part("head", ["sphere", 0.1, 1.8, 0.5, 0.6], hair, [0, 0.14, 0.12]);
            break;
        case "braids":
            /* Two plaits, each three knots and a tie. */
            cap();
            [-1, 1].forEach((sx) => {
                [0.14, 0.22, 0.3].forEach((y, i) => part("head", ["sphere", 0.046 - i * 0.004, 1, 1.2, 1], hair, [sx * 0.165, -y, -0.05]));
                part("head", ["sphere", 0.03, 1, 1, 1], GOLD, [sx * 0.165, -0.36, -0.05]);
                part("head", ["cone", 0.03, 0.08, 5], hair, [sx * 0.165, -0.42, -0.05], { rot: [Math.PI, 0, 0] });
            });
            break;
        case "shaved":
            part("head", ["dome", 0.196, 1, 1.02, 1.02, 0.4], hair, [0, 0.02, -0.005]);
            [-1, 1].forEach((sx) => part("head", ["box", 0.03, 0.08, 0.05], hair, [sx * 0.178, 0.0, 0.05]));
            break;
        default:
            /* Cropped, with a fringe that sweeps to one side and a few
               tufts that break the outline of the crown. */
            cap();
            part("head", ["sphere", 0.09, 1.6, 0.6, 0.7], hair, [0.05, 0.13, 0.12], { rot: [0, 0, -0.3] });
            part("head", ["cone", 0.055, 0.12, 5], hair, [-0.08, 0.19, -0.05], { rot: [-0.5, 0, 0.3] });
            part("head", ["cone", 0.055, 0.12, 5], hair, [0.04, 0.2, -0.09], { rot: [-0.7, 0, -0.1] });
            part("head", ["cone", 0.05, 0.1, 5], hair, [0.11, 0.17, 0.0], { rot: [0, 0, -0.5] });
    }
}

/* Headwear for look.headwear: "hood", "brim", "crown"; anything else (such
   as "none") adds nothing. Cloth takes the cloak colour, else the torso's. */
function headwearParts({ part }, look) {
    const cloth = look.cloak || look.torso;
    switch (look.headwear) {
        case "hood":
            part("head", ["sphere", 0.235, 1, 1.05, 1.05], cloth, [0, 0.02, -0.04]);
            part("head", ["cone", 0.12, 0.2, 8], cloth, [0, 0.05, -0.22], { rot: [-1.9, 0, 0] });
            /* The face shows through the opening, shadowed. */
            part("head", ["sphere", 0.15, 1, 1.1, 0.5], shade(cloth, 0.45), [0, 0, 0.11]);
            break;
        case "brim": {
            /* A felt hat: wide brim, a band, a dented crown and a feather. */
            const felt = "#6e5b43";
            part("head", ["taper", 0.34, 0.34, 0.03, 16], felt, [0, 0.14, 0]);
            part("head", ["taper", 0.15, 0.19, 0.17, 12], felt, [0, 0.24, 0]);
            part("head", ["taper", 0.192, 0.192, 0.035, 12], "#3f3326", [0, 0.17, 0]);
            part("head", ["box", 0.2, 0.03, 0.04], shade(felt, 0.75), [0, 0.32, 0]);
            part("head", ["cone", 0.028, 0.26, 4], look.cloak || "#d6455f", [0.17, 0.28, -0.05], { rot: [0, 0, -0.7] });
            break;
        }
        case "crown":
            part("head", ["taper", 0.2, 0.19, 0.08, 10], "#e3c25f", [0, 0.17, 0], { set: "fire" });
            for (let i = 0; i < 5; i += 1) {
                const a = (i / 5) * Math.PI * 2;
                part("head", ["cone", 0.04, 0.12, 4], "#e3c25f", [Math.sin(a) * 0.18, 0.26, Math.cos(a) * 0.18], { set: "fire" });
            }
            part("head", ["sphere", 0.03, 1, 1, 1], "#d6455f", [0, 0.18, 0.2], { set: "fire" });
            break;
        default:
    }
}

/* ── Creatures ──────────────────────────────────────────────────────────── */

/*
 * Four-legged animals from one recipe: a barrel of a body with a deeper
 * chest and a rump, a darker saddle along the back, a neck carrying the
 * head, a jaw that opens to bite, and a tail in two pieces so it can curl.
 *
 *   length, height   overall size
 *   color, belly     coat and underside
 *   head, snout      head size and how long the muzzle runs
 *   tail             { w, l, color?, bushy? }
 *   ears             "pointed" or "round"
 *   ruff             a mane of fur at the shoulders (wolves)
 *   teeth            "fangs" or "incisors"
 *
 * Proportions derive from `height`: the legs are half of it and the body
 * radius a fifth, so scaling a creature is a matter of its entry in
 * QUADRUPEDS. The body faces +z with the head end forward. Returns a spec
 * with `legs`: ["FL", "FR", "BL", "BR"] for models.js to rig.
 */
export function quadrupedSpec({ length, height, color, belly, head: h, tail, ears, snout = 1, ruff = false, teeth = "fangs" }) {
    const r = recipe();
    const { part, pivot } = r;
    const legH = height * 0.5;
    const rad = height * 0.2;
    const back = shade(color, 0.78);

    pivot("body", null, [0, 0, 0]);
    part("body", ["capsule", rad, length * 0.62], color, [0, legH + rad * 0.9, -length * 0.02], { rot: [Math.PI / 2, 0, 0] });
    part("body", ["sphere", rad * 1.18, 1, 1.05, 1.1], color, [0, legH + rad, length * 0.24]);
    part("body", ["sphere", rad * 1.06, 1.05, 1, 1.1], color, [0, legH + rad * 0.95, -length * 0.25]);
    part("body", ["sphere", rad * 0.95, 1.05, 0.7, 1.6], belly, [0, legH + rad * 0.45, length * 0.05]);
    part("body", ["sphere", rad * 0.7, 0.85, 0.42, 2.3], back, [0, legH + rad * 1.62, -length * 0.03]);
    if (ruff) {
        part("body", ["sphere", rad * 1.28, 1.2, 1.1, 0.85], shade(color, 1.1), [0, legH + rad * 1.35, length * 0.33]);
        [0.16, 0.03, -0.1].forEach((z, i) =>
            part("body", ["cone", rad * 0.26, rad * 0.55, 4], back, [0, legH + rad * (1.98 - i * 0.12), length * z], { rot: [-0.6, 0, 0] }),
        );
    }

    /* Front left, front right, back left, back right. Hind legs carry a
       haunch. */
    const lx = rad * 0.62;
    const lz = length * 0.33;
    const thick = Math.max(0.035, length * 0.055);
    const legs = [];
    [["FL", -lx, lz], ["FR", lx, lz], ["BL", -lx, -lz], ["BR", lx, -lz]].forEach(([name, x, z]) => {
        pivot(`leg${name}`, "body", [x, legH + rad * 0.4, z]);
        pivot(`knee${name}`, `leg${name}`, [0, -legH * 0.5, 0]);
        part(`leg${name}`, ["capsule", thick, legH * 0.5], shade(color, 0.85), [0, -legH * 0.25, 0]);
        if (z < 0) part(`leg${name}`, ["sphere", thick * 1.9, 0.9, 1.4, 1.25], color, [0, -legH * 0.08, 0]);
        part(`knee${name}`, ["capsule", thick * 0.88, legH * 0.42], shade(color, 0.65), [0, -legH * 0.21, 0]);
        part(`knee${name}`, ["sphere", thick * 1.25, 1, 0.6, 1.5], shade(color, 0.5), [0, -legH * 0.45, thick * 0.6]);
        legs.push(name);
    });

    /* Neck, head, muzzle and nose; eyes glow, so a pack in the dark is a
       pair of sparks before it is a shape. */
    pivot("neck", "body", [0, legH + rad * 1.5, length * 0.38]);
    part("neck", ["taper", rad * 0.7, rad * 0.95, rad * 1.6, 10], color, [0, rad * 0.2, rad * 0.3], { rot: [0.9, 0, 0] });
    part("neck", ["sphere", h * 0.5, 0.95, 0.85, 1.05], color, [0, h * 0.38, h * 0.5]);
    part("neck", ["sphere", h * 0.22, 1.6, 0.5, 1], back, [0, h * 0.62, h * 0.62]);
    part("neck", ["taper", h * 0.17, h * 0.3, h * 0.62 * snout, 8], belly, [0, h * 0.28, h * (0.95 + 0.2 * snout)], { rot: [Math.PI / 2, 0, 0] });
    part("neck", ["sphere", h * 0.09, 1.2, 0.9, 1], INK, [0, h * 0.3, h * (1.25 + 0.35 * snout)]);
    [-1, 1].forEach((sx) => part("neck", ["sphere", h * 0.075, 1, 1, 1], "#ffe9a8", [sx * h * 0.2, h * 0.5, h * 0.9], { set: "fire", unlit: true }));
    if (ears === "pointed") {
        [-1, 1].forEach((sx) => {
            part("neck", ["cone", h * 0.14, h * 0.38, 4], color, [sx * h * 0.24, h * 0.82, h * 0.38], { rot: [0, 0, -sx * 0.2] });
            part("neck", ["cone", h * 0.08, h * 0.24, 4], shade(color, 0.55), [sx * h * 0.235, h * 0.8, h * 0.43], { rot: [0, 0, -sx * 0.2] });
        });
    } else if (ears === "round") {
        [-1, 1].forEach((sx) => {
            part("neck", ["taper", h * 0.22, h * 0.22, h * 0.05, 10], color, [sx * h * 0.3, h * 0.76, h * 0.33], { rot: [Math.PI / 2, 0, 0] });
            part("neck", ["taper", h * 0.15, h * 0.15, h * 0.05, 10], "#d39a96", [sx * h * 0.3, h * 0.76, h * 0.36], { rot: [Math.PI / 2, 0, 0] });
        });
    }

    /* The lower jaw hangs from the back of the muzzle. */
    pivot("jaw", "neck", [0, h * 0.14, h * 0.85]);
    part("jaw", ["taper", h * 0.09, h * 0.17, h * 0.5 * snout, 8], shade(belly, 0.85), [0, 0, h * 0.27 * snout], { rot: [Math.PI / 2, 0, 0] });
    if (teeth === "incisors") {
        part("neck", ["box", h * 0.14, h * 0.14, h * 0.04], BONE, [0, h * 0.13, h * (1.1 + 0.4 * snout)]);
    } else {
        [-1, 1].forEach((sx) => part("jaw", ["cone", h * 0.035, h * 0.12, 4], BONE, [sx * h * 0.08, h * 0.08, h * 0.48 * snout]));
    }

    pivot("tail", "body", [0, legH + rad * 1.3, -length * 0.42], [-0.9, 0, 0]);
    const first = tail.l * 0.55;
    const rest = tail.l * 0.45;
    pivot("tailTip", "tail", [0, -first, 0]);
    const tailColor = tail.color ?? color;
    if (tail.bushy) {
        part("tail", ["sphere", tail.w, 1, first / tail.w / 2, 1], tailColor, [0, -first / 2, 0]);
        part("tailTip", ["sphere", tail.w * 0.85, 1, rest / tail.w / 1.6, 1], tailColor, [0, -rest * 0.4, 0]);
        part("tailTip", ["cone", tail.w * 0.75, rest * 0.5, 8], belly, [0, -rest * 0.95, 0], { rot: [Math.PI, 0, 0] });
    } else {
        part("tail", ["taper", tail.w * 0.75, tail.w, first, 6], tailColor, [0, -first / 2, 0]);
        part("tailTip", ["taper", tail.w * 0.35, tail.w * 0.75, rest, 6], tailColor, [0, -rest / 2, 0]);
    }
    r.legs = legs;
    return finished(r);
}

/* ── The bestiary ───────────────────────────────────────────────────────── */

/* The animals models.js builds with quadrupedSpec, keyed by creature kind
   (the keys of CREATURES in src/lib/game/creatures.js). Sizes are tile
   units. */
export const QUADRUPEDS = {
    rat: {
        length: 0.66,
        height: 0.36,
        color: "#9c8a5f",
        belly: "#c9b78e",
        head: 0.26,
        tail: { w: 0.035, l: 0.55, color: "#d39a96" },
        ears: "round",
        snout: 1.3,
        teeth: "incisors",
    },
    wolf: {
        length: 1.1,
        height: 0.78,
        color: "#8e9bb8",
        belly: "#c8d1e0",
        head: 0.38,
        tail: { w: 0.1, l: 0.52, bushy: true },
        ears: "pointed",
        snout: 1.2,
        ruff: true,
    },
};

const KOBOLD_SCALE = "#a8503d";

/* A kobold: a small lizard-person with a snout, horns, a crest of spines
   down head and back, a pale belly, claws and a tail in two pieces. It is
   a humanoid recipe with extra parts, so it poses with the humanoid rig
   (plus the tail/tailTip pivots added here); models.js shrinks it to 0.74
   and its weapon tier 1 gives it a spear. */
export function koboldSpec() {
    const r = humanoidRecipe({
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
        glowEyes: "#ffd27a",
    });
    const { part, pivot } = r;
    part("head", ["taper", 0.07, 0.13, 0.2, 8], "#e07a5f", [0, -0.04, 0.2], { rot: [Math.PI / 2, 0, 0] });
    part("head", ["taper", 0.05, 0.1, 0.16, 8], "#c4644f", [0, -0.11, 0.17], { rot: [Math.PI / 2, 0, 0] });
    [-1, 1].forEach((sx) => {
        part("head", ["sphere", 0.016, 1, 1, 1], INK, [sx * 0.03, -0.01, 0.3]);
        part("head", ["cone", 0.05, 0.2, 5], BONE, [sx * 0.12, 0.2, -0.04], { rot: [-0.5, 0, 0] });
        part("head", ["cone", 0.035, 0.13, 5], shade(BONE, 0.85), [sx * 0.07, 0.2, -0.12], { rot: [-0.9, 0, 0] });
        [-0.04, 0, 0.04].forEach((dx) => part(`ankle${sx < 0 ? "L" : "R"}`, ["cone", 0.018, 0.06, 4], BONE, [dx, -0.07, 0.2], { rot: [Math.PI / 2, 0, 0] }));
    });
    [[0.18, -0.08, -1.0], [0.11, -0.16, -1.3], [0.01, -0.2, -1.6]].forEach(([y, z, rx]) =>
        part("head", ["cone", 0.04, 0.12, 4], KOBOLD_SCALE, [0, y, z], { rot: [rx, 0, 0] }),
    );
    [0.42, 0.31, 0.2].forEach((y) => part("torso", ["cone", 0.035, 0.1, 4], KOBOLD_SCALE, [0, y, -0.14], { rot: [-1.2, 0, 0] }));
    part("torso", ["sphere", 0.13, 1, 1.5, 0.45], "#e8a07a", [0, 0.24, 0.1]);
    part("torso", ["box", 0.16, 0.2, 0.03], "#6b4a33", [0, -0.12, 0.12]);
    pivot("tail", "torso", [0, -0.02, -0.12], [2.04, 0, 0]);
    pivot("tailTip", "tail", [0, -0.3, 0]);
    part("tail", ["taper", 0.09, 0.055, 0.32, 6], "#d0705a", [0, -0.15, 0]);
    part("tailTip", ["taper", 0.055, 0.012, 0.32, 6], "#d0705a", [0, -0.15, 0]);
    return finished(r);
}

/* A troll: hunched, pot-bellied, mossy at the shoulders, with a heavy brow,
   an underbite and tusks. Built at bulk 1.35; models.js scales it 1.4 more,
   sets its hunch and gives it a club (see CREATURES there). */
export function trollSpec() {
    const skin = "#8f6fc2";
    const r = humanoidRecipe({
        skin,
        hair: "#4b3a66",
        hairstyle: "long",
        headwear: "none",
        cloak: null,
        torso: "#5d4c74",
        sleeves: skin,
        legs: "#5d4c74",
        boots: "#3b2f4a",
        belt: "#6b5b3c",
        armor: 0,
        weapon: 0,
        bulk: 1.35,
    });
    const { part } = r;
    part("head", ["box", 0.3, 0.06, 0.08], "#6f55a0", [0, 0.08, 0.15]);
    part("head", ["sphere", 0.07, 1, 0.8, 1], "#a68ad1", [0, -0.03, 0.18]);
    part("head", ["sphere", 0.14, 1.25, 0.6, 1], skin, [0, -0.12, 0.07]);
    [-1, 1].forEach((sx) => part("head", ["cone", 0.026, 0.1, 4], BONE, [sx * 0.07, -0.07, 0.17]));
    [[-0.12, 0.05, 0.13], [0.1, 0.12, 0.12], [0.14, -0.06, 0.12]].forEach((at) => part("head", ["sphere", 0.025, 1, 1, 1], shade(skin, 0.78), at));
    part("torso", ["sphere", 0.2, 1.7, 0.8, 1.1], skin, [0, 0.48, -0.06]);
    part("torso", ["sphere", 0.2, 1.05, 0.95, 0.9], shade(skin, 1.08), [0, 0.12, 0.07]);
    part("torso", ["box", 0.3, 0.22, 0.03], "#6b5b3c", [0, -0.14, 0.13]);
    [-1, 1].forEach((sx) => part("torso", ["dome", 0.1, 1.2, 0.7, 1], "#5f7a3a", [sx * 0.3, 0.52, -0.02], { set: "grass" }));
    return finished(r);
}

/* A shade: night only (src/lib/game/creatures.js). A thin hooded figure,
   all one dark, with nothing under the hood but two pale lights and a hem
   that frays into the dark. */
export function shadeSpec() {
    const dark = "#1d1830";
    const r = humanoidRecipe({
        skin: "#2a2540",
        hair: "#141022",
        hairstyle: "shaved",
        headwear: "hood",
        cloak: dark,
        torso: "#241f38",
        sleeves: "#241f38",
        legs: dark,
        boots: "#141022",
        belt: "#2a2540",
        armor: 0,
        weapon: 0,
        glowEyes: "#b9a8ff",
    });
    const { part } = r;
    [-0.2, -0.07, 0.07, 0.2].forEach((x, i) =>
        part("cape", ["cone", 0.05, 0.16, 4], shade(dark, 0.8), [x, -0.86, -0.07], { rot: [Math.PI, 0, (i - 1.5) * 0.15] }),
    );
    return finished(r);
}

/* ── Detail ─────────────────────────────────────────────────────────────── */

/*
 * How finely a sphere is cut, by how big it is: an eye needs a few facets,
 * a skull enough to shade in a smooth ramp. Small parts were most of a
 * figure's triangles when every sphere was cut the same.
 */
export function sphereSegments(r, sx = 1, sy = 1, sz = 1) {
    /* Thresholds are in tile units of the largest stretched radius:
       12x9 segments from 0.15 up (heads, bellies), 9x6 from 0.07 (hands,
       knees), 6x4 below (eyes, buttons). Returns [width, height]. */
    const size = r * Math.max(sx, sy, sz);
    if (size >= 0.15) return [12, 9];
    if (size >= 0.07) return [9, 6];
    return [6, 4];
}

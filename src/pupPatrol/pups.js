/*
 * The pups themselves.
 *
 * These are the characters. Everything else on the island is scenery they move
 * through, and a character built out of a box for a body and four boxes for
 * legs will undo any amount of work spent on the scenery — the eye goes to the
 * face first and judges the whole game on what it finds there.
 *
 * So the construction is deliberately front-loaded on the head. A stylised
 * animal reads from about six things, in this order: the size of the eyes
 * relative to the skull, the highlight in them, the shape of the muzzle, the
 * brows, the ears, and whether any of it moves independently of the body.
 * Everything below the collar is doing much less work, and is built to match.
 *
 * The animation follows the same priority. A four-legged gait that is merely
 * correct looks like a toy being dragged; what makes it look alive is the
 * secondary motion — the head staying level while the body bobs under it, the
 * ears arriving late, the tail carrying on after the turn has finished, and
 * the fact that a pup standing still is still breathing and still blinking.
 */

import * as THREE from "three";
import { heightAt, normalAt, SEA_LEVEL } from "./world";
import { obstacles } from "./obstacles";
import { roundedBox, pawGeometry } from "./geometry";

const _normal = new THREE.Vector3();
const _lookLocal = new THREE.Vector3();

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* --------------------------------------------------------------- *
 * Breeds
 *
 * Each pup in the show is a recognisable breed, and the markings are most of
 * what makes them recognisable at a glance — a white dog with black spots is
 * Marshall from fifty metres, before the colour of the uniform is legible.
 * --------------------------------------------------------------- */

const LOOKS = {
    /* `ears` is not decoration. A German Shepherd's ears stand up and a
       Dalmatian's hang down, and getting that one property right does more for
       telling seven pups apart at a glance than every other difference on this
       line put together. */
    chase: {
        fur: 0xd2a469, belly: 0xf6e8cd, muzzle: 0xf6e8cd, paw: 0xecd8b2, mark: 0x8a5a2b,
        pattern: "saddle", ears: "erect", pack: "megaphone",
    },
    marshall: {
        fur: 0xfcf8f1, belly: 0xffffff, muzzle: 0xf2ece2, paw: 0xe6ded0, mark: 0x2c2c31,
        pattern: "spots", ears: "flop", pack: "hose",
    },
    skye: {
        fur: 0xf7e0b4, belly: 0xfff6e4, muzzle: 0xfff6e4, paw: 0xeed9ae, mark: 0xd8b276,
        pattern: "none", ears: "flop", pack: "wings",
    },
    rubble: {
        fur: 0xddae54, belly: 0xf8e7bd, muzzle: 0xf8e7bd, paw: 0xc6913a, mark: 0xa87226,
        pattern: "patch", ears: "flop", pack: "shovel",
    },
    rocky: {
        fur: 0xc3bcae, belly: 0xf0ede4, muzzle: 0xf0ede4, paw: 0xa8a294, mark: 0x6f6a62,
        pattern: "patch", ears: "mixed", pack: "claw",
    },
    zuma: {
        fur: 0xb5814a, belly: 0xe0b47e, muzzle: 0xe0b47e, paw: 0x94623a, mark: 0x7d5028,
        pattern: "none", ears: "flop", pack: "scuba",
    },
    everest: {
        fur: 0xf6f1e9, belly: 0xffffff, muzzle: 0xf2ece2, paw: 0xdcd6cc, mark: 0x8494a4,
        pattern: "husky", ears: "erect", pack: "grapple",
    },
};

const lookFor = (id) => LOOKS[id] || LOOKS.chase;

/* --------------------------------------------------------------- *
 * Materials
 *
 * Fur is rough and barely reflective; eyes and noses are wet and very
 * reflective. That contrast is worth more than any amount of geometry: it is
 * what makes an eye look like an eye rather than a painted dot.
 * --------------------------------------------------------------- */

const materials = new Map();

function mat(colour, kind = "fur") {
    const key = `${colour}|${kind}`;
    let m = materials.get(key);
    if (m) return m;

    const presets = {
        fur: { roughness: 0.86, metalness: 0, envMapIntensity: 0.45 },
        cloth: { roughness: 0.7, metalness: 0.02, envMapIntensity: 0.5 },
        kit: { roughness: 0.34, metalness: 0.1, envMapIntensity: 1.0 },
        metal: { roughness: 0.2, metalness: 0.9, envMapIntensity: 1.5 },
        wet: { roughness: 0.06, metalness: 0.05, envMapIntensity: 1.8 },
        glass: { roughness: 0.04, metalness: 0, envMapIntensity: 2.2, transparent: true, opacity: 0.5 },
    };

    m = new THREE.MeshStandardMaterial({ color: colour, ...(presets[kind] || presets.fur) });
    materials.set(key, m);
    return m;
}

function part(geometry, colour, kind, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, mat(colour, kind));
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
}

function ball(radius, colour, kind, segments = 16) {
    return part(new THREE.SphereGeometry(radius, segments, Math.round(segments * 0.75)), colour, kind);
}

function capsule(radius, length, colour, kind, segments = 10) {
    return part(new THREE.CapsuleGeometry(radius, length, 5, segments), colour, kind);
}

function slab(w, h, d, colour, kind, radius) {
    return part(roundedBox(w, h, d, radius ?? Math.min(w, h, d) * 0.34, 3), colour, kind);
}

/* A soft tapered wedge: wide and thin at the base, narrowing to a rounded
   point. Ears are this shape, and a box with rounded corners is not. */
function coneGeometry(width, height, depth) {
    const geo = new THREE.CylinderGeometry(width * 0.14, width * 0.5, height, 12, 1);
    geo.scale(1, 1, depth / (width * 0.5));
    return geo;
}

/* A marking laid on the surface of a sphere: a flattened disc pushed out along
   its own normal so it sits on the fur rather than in it. Cheaper and far more
   controllable than trying to paint spots through a sphere's UVs, where
   everything near the poles turns into a smear. */
function marking(parent, radius, dir, size, colour, squash = 0.34) {
    const d = dir.clone().normalize();
    const spot = ball(size, colour, "fur", 12);
    spot.position.copy(d).multiplyScalar(radius * 0.965);
    spot.scale.set(1, 1, squash);
    spot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    spot.castShadow = false;
    parent.add(spot);
    return spot;
}

/* --------------------------------------------------------------- *
 * Head
 *
 * Shared with the driver sitting in each truck, so the face you see through
 * the windscreen is the same face you see when you get out.
 * --------------------------------------------------------------- */

/*
 * An ear.
 *
 * Two styles, and the difference is the single loudest identifier a pup has.
 * An erect ear is a tapered triangle standing off the top corner of the skull;
 * a flop ear is the same triangle hinged over halfway down so it hangs. Both
 * get a paler inner surface, because an ear with one colour is a fin.
 */
function buildEar(look, R, side, style) {
    const root = new THREE.Group();
    const ear = { root, side };

    if (style === "erect") {
        root.position.set(side * R * 0.7, R * 0.5, -R * 0.1);
        root.rotation.z = side * 0.32;
        root.rotation.x = -0.14;

        /* Thin front-to-back. The depth argument is what makes an ear an ear
           rather than a horn, and the first version was deeper than it was
           wide. */
        const shell = part(coneGeometry(R * 0.4, R * 0.94, R * 0.09), look.mark, "fur");
        shell.position.y = R * 0.44;
        root.add(shell);

        const inner = part(coneGeometry(R * 0.19, R * 0.52, R * 0.025), look.muzzle, "fur");
        inner.position.set(0, R * 0.34, R * 0.05);
        inner.castShadow = false;
        root.add(inner);

        /* Erect ears still move; they pivot near the tip rather than folding. */
        const hinge = new THREE.Group();
        hinge.position.y = R * 0.72;
        root.add(hinge);
        ear.hinge = hinge;
        ear.erect = true;
        return ear;
    }

    root.position.set(side * R * 0.82, R * 0.42, -R * 0.02);
    root.rotation.z = side * 0.46;
    root.rotation.x = -0.08;

    const upper = part(coneGeometry(R * 0.44, R * 0.6, R * 0.13), look.mark, "fur");
    upper.rotation.x = Math.PI;
    upper.position.y = -R * 0.28;
    root.add(upper);

    const hinge = new THREE.Group();
    hinge.position.y = -R * 0.56;
    root.add(hinge);

    const lower = part(coneGeometry(R * 0.34, R * 0.54, R * 0.1), look.mark, "fur");
    lower.rotation.x = Math.PI;
    lower.position.y = -R * 0.25;
    hinge.add(lower);

    const inner = part(coneGeometry(R * 0.15, R * 0.34, R * 0.025), look.muzzle, "fur");
    inner.rotation.x = Math.PI;
    inner.position.set(side * -R * 0.05, -R * 0.22, R * 0.07);
    inner.castShadow = false;
    hinge.add(inner);

    ear.hinge = hinge;
    ear.erect = false;
    return ear;
}

/*
 * The head.
 *
 * Three things carry the likeness, and everything else is scaffolding:
 *
 *   The eyes. Tall ovals, not spheres, set close together and taking up most
 *   of the front of the face — and the iris fills three quarters of the eye,
 *   which is the actual reason cartoon animals read as young. A round eyeball
 *   with a small iris reads as a bird.
 *
 *   The snout. It tapers. A ball stuck on a ball is a bear; a narrow bridge
 *   running out from between the eyes to a small rounded nose pad is a dog,
 *   and the taper is the whole difference.
 *
 *   The ears, per breed, above.
 *
 * Shared with the driver sitting in each truck, so the face you see through
 * the windscreen is the same face you see when you get out.
 */
export function buildPupHead(pup, options = {}) {
    const look = lookFor(pup.id);
    const head = new THREE.Group();
    const R = 0.3;

    /* Skull: a touch taller than it is deep, with the mass carried high. */
    const skull = ball(R, look.fur, "fur", 24);
    skull.scale.set(1, 1.04, 0.96);
    head.add(skull);

    /* The brow mass — a wider, flatter sphere across the top of the face. It
       is what the eyes sit under, and without it they sit *on* a ball. */
    const brow = ball(R * 0.68, look.fur, "fur", 18);
    brow.scale.set(1.08, 0.62, 0.82);
    brow.position.set(0, R * 0.34, R * 0.06);
    brow.castShadow = false;
    head.add(brow);

    /* ---- snout ----
       Bridge, pad and jaw. Three parts because the taper is the likeness. */
    const bridge = ball(R * 0.3, look.muzzle, "fur", 16);
    bridge.scale.set(0.78, 0.72, 1.7);
    bridge.position.set(0, -R * 0.1, R * 0.68);
    head.add(bridge);

    const pad = ball(R * 0.32, look.muzzle, "fur", 18);
    pad.scale.set(1.06, 0.9, 0.94);
    pad.position.set(0, -R * 0.16, R * 1.06);
    head.add(pad);

    const jaw = ball(R * 0.34, look.muzzle, "fur", 16);
    jaw.scale.set(0.94, 0.6, 1.15);
    jaw.position.set(0, -R * 0.42, R * 0.7);
    jaw.castShadow = false;
    head.add(jaw);

    /* Cheeks, tucked well inside the silhouette. Pushed out even slightly too
       far they stop reading as cheeks and start reading as a second pair of
       ears — which is exactly what happened the first time. */
    for (const side of [-1, 1]) {
        const cheek = ball(R * 0.3, look.fur, "fur", 12);
        cheek.scale.set(0.9, 0.86, 1.05);
        cheek.position.set(side * R * 0.5, -R * 0.3, R * 0.34);
        cheek.castShadow = false;
        head.add(cheek);
    }

    const nose = ball(R * 0.128, 0x2b2429, "wet", 16);
    nose.scale.set(1.3, 0.95, 0.9);
    nose.position.set(0, -R * 0.02, R * 1.3);
    head.add(nose);

    /* A smile, as an arc rather than a bar. The bar version reads as a frown
       no matter where it is put, because a straight mouth on a round face
       always does. */
    const smile = new THREE.Mesh(
        new THREE.TorusGeometry(R * 0.17, R * 0.022, 6, 16, Math.PI - 1.0),
        mat(0x4a2f2c, "fur")
    );
    smile.rotation.z = Math.PI + 0.5;
    smile.position.set(0, -R * 0.24, R * 1.2);
    smile.castShadow = false;
    head.add(smile);

    /* ---- eyes ----
       Tall ovals, close together, high on the face. */
    const eyes = [];
    for (const side of [-1, 1]) {
        const socket = new THREE.Group();
        socket.position.set(side * R * 0.33, R * 0.2, R * 0.72);
        socket.rotation.y = side * -0.16;
        head.add(socket);

        /* A dark rim just behind the eyeball. Without it a white sclera on
           white fur has no edge at all, and Marshall ends up with two faint
           smudges where his eyes should be. */
        const rim = ball(R * 0.31, 0x3b2f2b, "fur", 16);
        rim.scale.set(0.9, 1.3, 0.62);
        rim.castShadow = false;
        socket.add(rim);

        const white = ball(R * 0.295, 0xfdfdff, "wet", 20);
        white.scale.set(0.9, 1.3, 0.66);
        socket.add(white);

        /* The iris fills three quarters of the eye. This is the single
           strongest lever on how young a stylised animal reads, and the
           previous pass had it at barely half. */
        const iris = ball(R * 0.225, 0x59320f, "wet", 18);
        iris.scale.set(1, 1.06, 0.34);
        iris.position.set(side * R * 0.015, -R * 0.03, R * 0.15);
        socket.add(iris);

        const pupil = ball(R * 0.13, 0x0f0c0b, "wet", 14);
        pupil.scale.set(1, 1.08, 0.3);
        pupil.position.set(side * R * 0.015, -R * 0.03, R * 0.185);
        socket.add(pupil);

        /* Two highlights, offset the same way on both eyes — a highlight that
           mirrors between the eyes looks wrong and nobody can say why. */
        const glint = ball(R * 0.082, 0xffffff, "wet", 12);
        glint.scale.set(1, 1.1, 0.4);
        glint.position.set(-R * 0.085, R * 0.11, R * 0.2);
        glint.castShadow = false;
        socket.add(glint);
        const glint2 = ball(R * 0.038, 0xffffff, "wet", 8);
        glint2.scale.set(1, 1.1, 0.4);
        glint2.position.set(R * 0.09, -R * 0.11, R * 0.19);
        glint2.castShadow = false;
        socket.add(glint2);

        /* ---- the lid ----
         *
         * Hung from a pivot at the top of the eye and scaled down rather than
         * slid up out of the way. Sliding is the obvious approach and it does
         * not work: parked high enough to uncover the eye, the lid clears the
         * skull entirely and sits above the head as a pale egg — which is
         * exactly what the previous version was doing, and it read so much
         * like an ear that it took a screenshot to notice.
         *
         * Scaling from a pivot at the brow closes the way a real lid closes,
         * top downward, and vanishes completely when open. */
        const lidPivot = new THREE.Group();
        lidPivot.position.y = R * 0.4;
        lidPivot.scale.y = 0;
        socket.add(lidPivot);

        const lid = ball(R * 0.33, look.fur, "fur", 16);
        lid.scale.set(0.94, 1.3, 0.74);
        lid.position.y = -R * 0.33 * 1.3;
        lid.castShadow = false;
        lidPivot.add(lid);

        /* A dark line along the top edge of the eye, always there. Every drawn
           version of these characters has one, and it is what stops a big
           round eye reading as a marble. */
        const lash = new THREE.Mesh(
            new THREE.TorusGeometry(R * 0.27, R * 0.019, 6, 16, Math.PI * 0.85),
            mat(0x2f2521, "fur")
        );
        lash.scale.set(1, 1.16, 0.5);
        lash.position.set(0, R * 0.01, R * 0.17);
        lash.rotation.z = -0.4;
        lash.castShadow = false;
        socket.add(lash);

        eyes.push({ socket, lid: lidPivot });
    }

    /* ---- ears ---- */
    const ears = [];
    for (const side of [-1, 1]) {
        let style = look.ears;
        /* Rocky wears one up and one down, which is the entire joke. */
        if (style === "mixed") style = side < 0 ? "erect" : "flop";
        const ear = buildEar(look, R, side, style);
        head.add(ear.root);
        ears.push(ear);
    }

    /* ---- cap ----
       A baseball cap: rounded crown, a curved peak, the emblem on the front,
       sitting between the ears rather than over them. */
    if (options.cap !== false) {
        const cap = new THREE.Group();
        cap.position.set(0, R * 0.6, R * 0.04);
        cap.rotation.x = -0.1;
        head.add(cap);

        const crown = part(
            new THREE.SphereGeometry(R * 0.62, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.66),
            pup.colour,
            "kit"
        );
        crown.scale.set(1.06, 0.84, 1.06);
        cap.add(crown);

        const seam = part(new THREE.TorusGeometry(R * 0.65, R * 0.042, 8, 26), pup.trim, "kit");
        seam.rotation.x = Math.PI / 2;
        seam.position.y = -R * 0.02;
        cap.add(seam);

        /* A curved peak, from a shallow ring segment. A flat slab reads as a
           visor. */
        const peak = part(
            new THREE.CylinderGeometry(R * 0.88, R * 0.88, R * 0.06, 20, 1, false, -0.9, 1.8),
            pup.colour,
            "kit"
        );
        peak.scale.set(1, 1, 0.66);
        peak.position.set(0, -R * 0.02, R * 0.18);
        cap.add(peak);

        const button = ball(R * 0.09, pup.trim, "kit", 10);
        button.position.y = R * 0.52;
        cap.add(button);

        const badge = part(pawGeometry(R * 0.42, R * 0.03), 0xffffff, "kit", 0, R * 0.18, R * 0.5);
        badge.rotation.x = -0.4;
        cap.add(badge);
    }

    /* ---- breed markings ---- */
    if (look.pattern === "spots") {
        [
            [-0.6, 0.55, 0.55, 0.19],
            [0.68, 0.3, 0.5, 0.16],
            [-0.85, -0.1, 0.15, 0.14],
            [0.5, 0.72, -0.2, 0.15],
        ].forEach(([x, y, z, r]) => marking(head, R, new THREE.Vector3(x, y, z), R * r, look.mark));
    } else if (look.pattern === "saddle") {
        marking(head, R, new THREE.Vector3(0, 0.8, -0.5), R * 0.42, look.mark, 0.26);
    } else if (look.pattern === "husky") {
        for (const side of [-1, 1]) {
            marking(head, R, new THREE.Vector3(side * 0.5, 0.6, 0.4), R * 0.26, look.mark, 0.22);
        }
    } else if (look.pattern === "patch") {
        marking(head, R, new THREE.Vector3(-0.62, 0.35, 0.55), R * 0.28, look.mark, 0.22);
    }

    head.userData = { eyes, ears, skull };
    return head;
}

/* --------------------------------------------------------------- *
 * The pack each pup wears
 *
 * In the show this is the thing that says what a pup is *for*, and it reads
 * from behind — which is the angle you spend nearly all your time looking at
 * a character from in a third-person game.
 * --------------------------------------------------------------- */

function buildPack(pup) {
    const look = lookFor(pup.id);
    const pack = new THREE.Group();

    const shell = slab(0.34, 0.26, 0.3, pup.colour, "kit", 0.07);
    pack.add(shell);
    const lid = slab(0.36, 0.05, 0.32, pup.trim, "kit", 0.02);
    lid.position.y = 0.15;
    pack.add(lid);

    const kit = new THREE.Group();
    pack.add(kit);

    if (look.pack === "megaphone") {
        const cone = part(new THREE.CylinderGeometry(0.1, 0.05, 0.18, 12, 1, true), 0xd7dde4, "metal");
        cone.rotation.x = -Math.PI / 2;
        cone.position.set(0, 0.2, 0.14);
        cone.material = mat(0xd7dde4, "metal");
        kit.add(cone);
    } else if (look.pack === "hose") {
        const reel = part(new THREE.TorusGeometry(0.11, 0.045, 8, 18), 0xf2f5fb, "kit");
        reel.rotation.y = Math.PI / 2;
        reel.position.set(0, 0.2, 0);
        kit.add(reel);
        const nozzle = part(new THREE.CylinderGeometry(0.028, 0.038, 0.2, 10), 0xd7dde4, "metal");
        nozzle.rotation.x = Math.PI / 2.3;
        nozzle.position.set(0.12, 0.2, 0.1);
        kit.add(nozzle);
    } else if (look.pack === "wings") {
        for (const side of [-1, 1]) {
            const wing = slab(0.3, 0.05, 0.16, pup.accent, "kit", 0.02);
            wing.position.set(side * 0.26, 0.12, -0.02);
            wing.rotation.z = side * -0.28;
            kit.add(wing);
        }
    } else if (look.pack === "shovel") {
        const shaft = part(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), 0x8a6134, "kit");
        shaft.rotation.x = 0.4;
        shaft.position.set(0.1, 0.22, -0.06);
        kit.add(shaft);
        const blade = slab(0.14, 0.16, 0.03, 0xc9ced4, "metal", 0.02);
        blade.position.set(0.16, 0.38, 0.02);
        blade.rotation.x = 0.4;
        kit.add(blade);
    } else if (look.pack === "claw") {
        const arm = part(new THREE.CylinderGeometry(0.028, 0.028, 0.26, 8), 0xa8b0b8, "metal");
        arm.rotation.x = -0.5;
        arm.position.set(0, 0.24, 0.02);
        kit.add(arm);
        const jaw = part(new THREE.TorusGeometry(0.07, 0.022, 8, 12, Math.PI), 0xe2e7ec, "metal");
        jaw.position.set(0, 0.36, 0.1);
        kit.add(jaw);
    } else if (look.pack === "scuba") {
        for (const side of [-1, 1]) {
            const tank = part(new THREE.CapsuleGeometry(0.055, 0.16, 4, 10), pup.accent, "kit");
            tank.position.set(side * 0.09, 0.16, -0.04);
            kit.add(tank);
        }
    } else if (look.pack === "grapple") {
        const hook = part(new THREE.TorusGeometry(0.08, 0.024, 8, 14, Math.PI * 1.4), 0xe2e7ec, "metal");
        hook.position.set(0, 0.24, 0.02);
        hook.rotation.x = 0.4;
        kit.add(hook);
    }

    return pack;
}

/* --------------------------------------------------------------- *
 * The whole pup
 * --------------------------------------------------------------- */

/*
 * The whole pup.
 *
 * Proportions are the entire game here. A dog built to life proportions is a
 * long low animal whose head is a tenth of it, and rendered at the size these
 * are it reads as a sheep. What reads as a *puppy* is the caricature every
 * animator uses: an oversized head, a short deep body, and legs short enough
 * that the belly is close to the ground. The numbers below are that
 * caricature, measured against a head radius of 0.30 and then scaled down as a
 * whole at the end — so the driver in the truck and the character on the grass
 * can share one head at two different sizes.
 */

/* Top of the ears lands around 0.7 m: knee-height to a person, small beside a
   four-metre truck, which is exactly the relationship the show uses. */
const PUP_SCALE = 0.62;

export function buildPupMesh(pup) {
    const look = lookFor(pup.id);
    const group = new THREE.Group();
    group.name = `pup-${pup.id}`;
    group.scale.setScalar(PUP_SCALE);

    /* Everything hangs off `root`, which is the thing that bobs, rolls and
       leans. Keeping the world transform on `group` and the animation on
       `root` means the two never fight. */
    const root = new THREE.Group();
    root.position.y = 0.435;
    group.add(root);

    /* ---- torso ----
       Deep and short. The chest sits forward and a shade higher than the hips,
       which is what gives a four-legged animal its line. */
    const chest = capsule(0.163, 0.22, look.fur, "fur", 16);
    chest.rotation.x = Math.PI / 2;
    chest.position.set(0, 0.015, 0.075);
    root.add(chest);

    const hips = ball(0.175, look.fur, "fur", 18);
    hips.scale.set(1, 0.95, 1.14);
    hips.position.set(0, -0.005, -0.2);
    root.add(hips);

    const belly = ball(0.15, look.belly, "fur", 14);
    belly.scale.set(0.95, 0.66, 1.7);
    belly.position.set(0, -0.075, -0.02);
    belly.castShadow = false;
    root.add(belly);

    /* Shoulders and haunches. Two spheres each side, and the animal stops
       being a barrel with sticks in it — this is where the legs visibly come
       *from*, and its absence is why the first pass read as a lamb. */
    for (const side of [-1, 1]) {
        const shoulder = ball(0.105, look.fur, "fur", 12);
        shoulder.scale.set(0.8, 1, 1.05);
        shoulder.position.set(side * 0.12, -0.02, 0.15);
        root.add(shoulder);

        const haunch = ball(0.12, look.fur, "fur", 12);
        haunch.scale.set(0.78, 1.05, 1.1);
        haunch.position.set(side * 0.125, -0.015, -0.17);
        root.add(haunch);
    }

    /* A ruff where the neck meets the chest, so the head is joined on rather
       than balanced on top. */
    const neckColumn = capsule(0.088, 0.07, look.fur, "fur", 12);
    neckColumn.rotation.x = 0.5;
    neckColumn.position.set(0, 0.115, 0.185);
    root.add(neckColumn);

    const ruff = ball(0.125, look.fur, "fur", 14);
    ruff.scale.set(1, 0.9, 0.72);
    ruff.position.set(0, 0.06, 0.16);
    root.add(ruff);

    /* Markings hang off their own unrotated, unscaled anchor. Putting them on
       the chest capsule looks equivalent and is not: that capsule is rotated a
       quarter turn to lie along Z, so every direction handed to it comes out
       somewhere else entirely. */
    const hide = new THREE.Group();
    root.add(hide);

    if (look.pattern === "spots") {
        [
            [0.62, 0.55, 0.35, 0.05],
            [-0.7, 0.4, -0.2, 0.062],
            [0.15, 0.72, -0.62, 0.055],
            [-0.35, 0.6, 0.6, 0.045],
            [0.55, 0.2, -0.75, 0.04],
        ].forEach(([x, y, z, r]) => {
            const spot = ball(r, look.mark, "fur", 12);
            const dir = new THREE.Vector3(x, y, z).normalize();
            spot.position.set(dir.x * 0.195, dir.y * 0.17 - 0.01, dir.z * 0.27 - 0.05);
            spot.scale.set(1, 0.6, 1);
            spot.castShadow = false;
            hide.add(spot);
        });
    } else if (look.pattern === "saddle" || look.pattern === "husky") {
        /* A darker coat over the back and shoulders, stopping short of the
           belly. Two spheres rather than one so it follows the body's line. */
        const back = ball(0.185, look.mark, "fur", 18);
        back.scale.set(0.98, 0.92, 1.3);
        back.position.set(0, 0.02, 0.02);
        back.castShadow = false;
        hide.add(back);
        const rump = ball(0.184, look.mark, "fur", 16);
        rump.scale.set(0.98, 0.92, 1.1);
        rump.position.set(0, 0.01, -0.19);
        rump.castShadow = false;
        hide.add(rump);
    } else if (look.pattern === "patch") {
        const patch = ball(0.14, look.mark, "fur", 14);
        patch.scale.set(0.8, 0.7, 1.2);
        patch.position.set(0.09, 0.05, -0.16);
        patch.castShadow = false;
        hide.add(patch);
    }

    /* ---- uniform ---- */
    const vest = capsule(0.196, 0.13, pup.colour, "cloth", 16);
    vest.rotation.x = Math.PI / 2;
    vest.position.set(0, 0.015, -0.01);
    root.add(vest);

    const stripe = capsule(0.199, 0.024, pup.accent, "cloth", 16);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.set(0, 0.015, -0.01);
    root.add(stripe);

    const collar = part(new THREE.TorusGeometry(0.142, 0.032, 8, 20), pup.colour, "cloth", 0, 0.085, 0.19);
    collar.rotation.x = Math.PI / 2 - 0.42;
    root.add(collar);

    const tag = part(pawGeometry(0.16, 0.03), 0xffd83d, "metal", 0, 0.015, 0.255);
    root.add(tag);

    const pack = buildPack(pup);
    pack.scale.setScalar(0.78);
    pack.position.set(0, 0.17, -0.13);
    root.add(pack);

    /* ---- head ---- */
    const neck = new THREE.Group();
    neck.position.set(0, 0.135, 0.2);
    root.add(neck);

    const head = buildPupHead(pup);
    head.scale.setScalar(0.95);
    head.position.set(0, 0.2, 0.11);
    neck.add(head);

    /* ---- legs ----
       Three joints each. The knee matters: a leg that swings from the hip as
       one rigid stick is the single clearest tell that an animation was done
       in an afternoon. */
    const legs = [];
    const layout = [
        { x: -0.115, z: 0.17, front: true },
        { x: 0.115, z: 0.17, front: true },
        { x: -0.128, z: -0.18, front: false },
        { x: 0.128, z: -0.18, front: false },
    ];
    layout.forEach(({ x, z, front }) => {
        const hip = new THREE.Group();
        hip.position.set(x, -0.03, z);
        root.add(hip);

        const upper = capsule(0.046, 0.12, look.fur, "fur", 10);
        upper.position.y = -0.086;
        hip.add(upper);

        const knee = new THREE.Group();
        knee.position.y = -0.172;
        hip.add(knee);

        const lower = capsule(0.038, 0.1, look.fur, "fur", 10);
        lower.position.y = -0.078;
        knee.add(lower);

        const ankle = new THREE.Group();
        ankle.position.y = -0.156;
        knee.add(ankle);

        const paw = slab(0.104, 0.066, 0.135, look.paw, "fur", 0.03);
        paw.position.set(0, -0.028, 0.018);
        ankle.add(paw);

        legs.push({ hip, knee, ankle, front });
    });

    /* ---- tail ----
       Three segments on a spring, so it carries on after a turn ends. */
    const tail = [];
    let parent = root;
    for (let i = 0; i < 3; i += 1) {
        const joint = new THREE.Group();
        joint.position.set(0, i === 0 ? 0.085 : 0, i === 0 ? -0.32 : -0.085);
        parent.add(joint);
        const segment = capsule(0.042 - i * 0.009, 0.07, i === 2 ? look.belly : look.fur, "fur", 8);
        segment.rotation.x = Math.PI / 2;
        segment.position.z = -0.045;
        joint.add(segment);
        tail.push(joint);
        parent = joint;
    }
    tail[0].rotation.x = -0.75;

    group.userData = {
        root,
        neck,
        head,
        legs,
        tail,
        eyes: head.userData.eyes,
        ears: head.userData.ears,
        baseHeight: root.position.y,
    };
    return group;
}

/* ---------------------------------------------------------------- *
 * On-foot controller
 * ---------------------------------------------------------------- */

const WALK_SPEED = 4.6;
const RUN_SPEED = 8.8;
const JUMP_SPEED = 8.4;
const GRAVITY = 22;
const RADIUS = 0.32;

export class PupOnFoot {
    constructor(mesh) {
        this.mesh = mesh;
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.heading = 0;
        this.grounded = true;
        this.speed = 0;
        this.stride = 0;
        this.scratch = [];

        /* Secondary motion state. All of it is a spring of some kind, because
           everything on an animal that is not being driven directly is
           something being dragged along behind something else. */
        this.earPitch = 0;
        this.earVelocity = 0;
        this.tailSwing = 0;
        this.tailVelocity = 0;
        this.wag = 0;
        this.blink = 0;
        this.blinkTimer = 1.5;
        this.lookYaw = 0;
        this.lookPitch = 0;
        this.landSquash = 0;
        this.lastVerticalSpeed = 0;
        this.lookTarget = null;

        /* The vehicle code reads these; on foot they are always empty. */
        this.wheels = [];
        this.groundedCount = 1;
        this.airborneFor = 0;
        this.upsideDownFor = 0;
        this.inWater = false;
        this.rotorSpeed = 0;
        this.throttle = 0;
        this.forwardSpeed = 0;
        this.lateralSpeed = 0;
        this.driftAngle = 0;
    }

    placeAt(x, z, heading) {
        this.position.set(x, heightAt(x, z) + 0.02, z);
        this.velocity.set(0, 0, 0);
        this.heading = heading;
        this.grounded = true;
    }

    recover() {
        this.position.y = heightAt(this.position.x, this.position.z) + 0.02;
        this.velocity.set(0, 0, 0);
    }

    /* Movement is relative to the camera, which is what every third-person
       game does and what everybody's hands already expect. */
    step(dt, controls, cameraYaw, lookAt) {
        this.lookTarget = lookAt || null;

        const forwardInput = controls.throttle - controls.brake;
        const strafeInput = controls.steer;

        const sin = Math.sin(cameraYaw);
        const cos = Math.cos(cameraYaw);
        let wishX = sin * forwardInput + cos * strafeInput;
        let wishZ = cos * forwardInput - sin * strafeInput;
        const wishLength = Math.hypot(wishX, wishZ);

        const running = controls.handbrake;
        const targetSpeed = running ? RUN_SPEED : WALK_SPEED;

        if (wishLength > 0.001) {
            wishX /= wishLength;
            wishZ /= wishLength;
            const target = Math.atan2(wishX, wishZ);
            /* Turn toward where you are going rather than snapping. */
            let delta = target - this.heading;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            const turn = delta * Math.min(1, dt * 12);
            this.heading += turn;
            /* A turn throws the tail out. */
            this.tailVelocity -= turn * 26;

            const accel = this.grounded ? 34 : 9;
            this.velocity.x += (wishX * targetSpeed - this.velocity.x) * Math.min(1, dt * accel);
            this.velocity.z += (wishZ * targetSpeed - this.velocity.z) * Math.min(1, dt * accel);
        } else if (this.grounded) {
            const brake = Math.min(1, dt * 16);
            this.velocity.x -= this.velocity.x * brake;
            this.velocity.z -= this.velocity.z * brake;
        }

        if (controls.jump && this.grounded) {
            this.velocity.y = JUMP_SPEED;
            this.grounded = false;
            this.earVelocity -= 14;
        }

        this.lastVerticalSpeed = this.velocity.y;
        this.velocity.y -= GRAVITY * dt;
        this.position.addScaledVector(this.velocity, dt);

        /* Ground. Steep slopes push you back down rather than letting you
           walk up a cliff face. */
        const groundY = heightAt(this.position.x, this.position.z);
        if (this.position.y <= groundY + 0.02) {
            if (!this.grounded) {
                /* Landing: the whole body compresses and the ears catch up
                   half a beat later. */
                const impact = clamp(-this.lastVerticalSpeed / 12, 0, 1);
                this.landSquash = impact;
                this.earVelocity += impact * 22;
            }
            this.position.y = groundY + 0.02;
            if (this.velocity.y < 0) this.velocity.y = 0;
            this.grounded = true;
            this.airborneFor = 0;

            normalAt(this.position.x, this.position.z, _normal);
            if (_normal.y < 0.62) {
                const slide = (0.62 - _normal.y) * 26;
                this.velocity.x += _normal.x * slide * dt;
                this.velocity.z += _normal.z * slide * dt;
            }
        } else {
            this.grounded = false;
            this.airborneFor += dt;
        }

        /* Swimming: bob at the surface and move slowly. */
        this.inWater = this.position.y < SEA_LEVEL + 0.3;
        if (this.inWater) {
            this.position.y += (SEA_LEVEL + 0.1 - this.position.y) * Math.min(1, dt * 6);
            this.velocity.y = 0;
            this.velocity.x *= 1 - Math.min(0.6, dt * 3);
            this.velocity.z *= 1 - Math.min(0.6, dt * 3);
            this.grounded = true;
        }

        obstacles.resolve(this, RADIUS, this.scratch);

        this.speed = Math.hypot(this.velocity.x, this.velocity.z);
        this.forwardSpeed = this.speed;
        this.stride += this.speed * dt;

        this.animate(dt);
    }

    /* ------------------------------------------------------------ *
     * Animation
     * ------------------------------------------------------------ */

    animate(dt) {
        const parts = this.mesh.userData;
        if (!parts || !parts.root) return;

        const { root, neck, legs, tail, ears, eyes, baseHeight } = parts;
        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = this.heading;

        const pace = clamp(this.speed / RUN_SPEED, 0, 1);
        const moving = this.speed > 0.35;
        /* Stride is distance-based, so the feet keep up with the ground
           instead of sliding when the speed changes. */
        const phase = this.stride * 3.1;

        /* ---- gait ----
           A trot: diagonal pairs move together, which is what a dog at this
           speed actually does and what stops the walk looking like a rocking
           horse. The knee tucks on the swing and straightens for the plant. */
        for (let i = 0; i < legs.length; i += 1) {
            const leg = legs[i];
            /* Legs are ordered front-left, front-right, rear-left, rear-right;
               the diagonal pairs are (0,3) and (1,2). */
            const offset = i === 0 || i === 3 ? 0 : Math.PI;
            const p = phase + offset;

            if (!this.grounded) {
                /* Airborne: front legs reach forward, rear legs trail, and
                   the pose eases in rather than snapping the moment the paws
                   leave the ground. */
                const ease = Math.min(1, dt * 9);
                leg.hip.rotation.x += ((leg.front ? -0.8 : 0.6) - leg.hip.rotation.x) * ease;
                leg.knee.rotation.x += ((leg.front ? 0.5 : -0.7) - leg.knee.rotation.x) * ease;
                leg.ankle.rotation.x += (0.2 - leg.ankle.rotation.x) * ease;
                continue;
            }

            const swing = Math.sin(p);
            const lift = Math.max(0, swing);
            const amount = 0.28 + pace * 0.55;

            leg.hip.rotation.x = swing * amount * (moving ? 1 : 0.06);
            /* The knee only ever bends one way. */
            leg.knee.rotation.x = -lift * (0.4 + pace * 0.75) * (moving ? 1 : 0.1);
            /* The paw levels out for the plant and points on the way through. */
            leg.ankle.rotation.x = (lift * 0.5 - swing * 0.25) * (moving ? 1 : 0);
        }

        /* ---- body ----
           Bob at twice the stride frequency, roll with the leading diagonal,
           and lean forward with pace. Landing compresses the whole thing. */
        this.landSquash = Math.max(0, this.landSquash - dt * 3.4);
        const breathe = Math.sin(performance.now() * 0.0022) * 0.006 * (1 - pace);
        const bob = moving ? Math.abs(Math.sin(phase)) * 0.035 * (0.4 + pace) : 0;

        root.position.y = baseHeight + bob + breathe - this.landSquash * 0.14;
        root.rotation.z = moving ? Math.sin(phase) * 0.07 * pace : 0;
        root.rotation.x = -pace * 0.2 + this.landSquash * 0.18;
        root.scale.set(1 + this.landSquash * 0.09, 1 - this.landSquash * 0.13, 1 + this.landSquash * 0.09);

        /* ---- head ----
           Counter-rotates so it stays level while the body works underneath
           it. Every four-legged animal does this and its absence is why a lot
           of game creatures look like they are being carried. */
        this.updateLook(dt);
        neck.rotation.x = -root.rotation.x * 0.75 + this.lookPitch + bob * -1.2;
        neck.rotation.y = this.lookYaw;
        neck.rotation.z = -root.rotation.z * 0.7;

        /* ---- ears ----
           Driven by a spring that is kicked by the body's vertical motion, so
           they arrive a moment after the pup does. */
        const earTarget = -pace * 0.35;
        this.earVelocity += (earTarget - this.earPitch) * 130 * dt;
        this.earVelocity -= this.earVelocity * Math.min(1, dt * 9);
        this.earVelocity += (moving ? Math.cos(phase * 2) * pace * 34 : 0) * dt;
        this.earPitch += this.earVelocity * dt;
        this.earPitch = clamp(this.earPitch, -1.1, 0.9);
        for (let i = 0; i < ears.length; i += 1) {
            const ear = ears[i];
            if (ear.erect) {
                /* An ear that stands up does not flop; it swivels and tips
                   back. Driving both styles off the same spring with the same
                   sign would have a German Shepherd's ears folding inside out
                   every time he landed. */
                ear.root.rotation.x = -0.14 + this.earPitch * 0.3;
                ear.root.rotation.z = ear.side * (0.26 - this.earPitch * 0.16);
            } else {
                ear.root.rotation.x = -0.1 + this.earPitch * 0.5;
                ear.hinge.rotation.x = this.earPitch;
                ear.hinge.rotation.z = ear.side * this.earPitch * 0.22;
            }
        }

        /* ---- tail ----
           The same spring, plus a wag whose speed says how the pup feels about
           the pace. */
        this.wag += dt * (2.4 + pace * 9);
        this.tailVelocity += -this.tailSwing * 120 * dt;
        this.tailVelocity -= this.tailVelocity * Math.min(1, dt * 6);
        this.tailSwing += this.tailVelocity * dt;
        this.tailSwing = clamp(this.tailSwing, -1.2, 1.2);
        const wagAmount = Math.sin(this.wag) * (0.24 + pace * 0.3);
        for (let i = 0; i < tail.length; i += 1) {
            const falloff = 1 - i * 0.18;
            tail[i].rotation.y = (this.tailSwing * 0.5 + wagAmount) * falloff;
            tail[i].rotation.x = (i === 0 ? -0.7 : 0.12) - pace * 0.18 * falloff + Math.sin(this.wag * 2) * 0.05;
        }

        /* ---- blinking ---- */
        this.blinkTimer -= dt;
        if (this.blinkTimer <= 0) {
            this.blink = 1;
            /* Irregular, because a metronome blink is worse than none. */
            this.blinkTimer = 1.8 + Math.random() * 4.5;
        }
        this.blink = Math.max(0, this.blink - dt * 7);
        /* One fast down-up rather than a linear fade. */
        const shut = Math.sin(clamp(this.blink, 0, 1) * Math.PI);
        for (let i = 0; i < eyes.length; i += 1) {
            const lid = eyes[i].lid;
            lid.scale.y = shut;
            lid.visible = shut > 0.02;
        }
    }

    /* Where the head is pointing. Toward whatever the game handed us — the
       camera, usually — but only within the range a neck actually has, and
       eased so it never snaps. */
    updateLook(dt) {
        let wantYaw = 0;
        let wantPitch = 0;

        if (this.lookTarget && this.speed < 3.5) {
            _lookLocal.copy(this.lookTarget).sub(this.position);
            const local = Math.atan2(_lookLocal.x, _lookLocal.z) - this.heading;
            let delta = local;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            /* Past about seventy degrees a dog turns its body, not its neck. */
            wantYaw = clamp(delta, -1.2, 1.2);
            const flat = Math.hypot(_lookLocal.x, _lookLocal.z);
            wantPitch = clamp(-Math.atan2(_lookLocal.y - 0.6, Math.max(flat, 0.4)), -0.5, 0.35);
            /* Fade the look out as the pup gets moving. */
            const attention = 1 - clamp(this.speed / 3.5, 0, 1);
            wantYaw *= attention;
            wantPitch *= attention;
        }

        this.lookYaw += (wantYaw - this.lookYaw) * Math.min(1, dt * 4);
        this.lookPitch += (wantPitch - this.lookPitch) * Math.min(1, dt * 4);
    }
}

export { LOOKS as PUP_LOOKS, lookFor as pupLook };

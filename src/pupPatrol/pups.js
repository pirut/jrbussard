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
    chase: { fur: 0xd0a065, belly: 0xf3e3c4, muzzle: 0xf0dcbb, paw: 0xe8d3ab, mark: 0x8a5a2b, pattern: "saddle", pack: "megaphone" },
    marshall: { fur: 0xfbf7ef, belly: 0xffffff, muzzle: 0xe6ded0, paw: 0xddd3c2, mark: 0x2c2c31, pattern: "spots", pack: "hose" },
    skye: { fur: 0xf6ddaf, belly: 0xfff3de, muzzle: 0xfdf0d6, paw: 0xecd6a8, mark: 0xd8b276, pattern: "none", pack: "wings" },
    rubble: { fur: 0xdaa94c, belly: 0xf6e2b4, muzzle: 0xf2dda9, paw: 0xc6913a, mark: 0xa87226, pattern: "patch", pack: "shovel" },
    rocky: { fur: 0xc0b9ab, belly: 0xeeeae0, muzzle: 0xe4dfd4, paw: 0xa8a294, mark: 0x6f6a62, pattern: "patch", pack: "claw" },
    zuma: { fur: 0xb07b45, belly: 0xdcae76, muzzle: 0xd9ab72, paw: 0x94623a, mark: 0x7d5028, pattern: "none", pack: "scuba" },
    everest: { fur: 0xf4eee5, belly: 0xffffff, muzzle: 0xe8e2d8, paw: 0xd6d0c6, mark: 0x8494a4, pattern: "husky", pack: "grapple" },
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

export function buildPupHead(pup, options = {}) {
    const look = lookFor(pup.id);
    const head = new THREE.Group();
    const R = 0.3;

    const skull = ball(R, look.fur, "fur", 22);
    skull.scale.set(1, 0.96, 1.02);
    head.add(skull);

    /* Cheeks: two small spheres broadening the jaw. Kept well inside the
       skull's silhouette — pushed out even slightly too far they stop reading
       as cheeks and start reading as a second pair of ears. */
    for (const side of [-1, 1]) {
        const cheek = ball(R * 0.3, look.muzzle, "fur", 12);
        cheek.scale.set(1, 0.85, 1.1);
        cheek.position.set(side * R * 0.46, -R * 0.34, R * 0.5);
        cheek.castShadow = false;
        head.add(cheek);
    }

    /* Muzzle: a stubby rounded wedge, wider than it is tall, protruding a
       clear third of a head radius past the skull. */
    const muzzle = ball(R * 0.46, look.muzzle, "fur", 18);
    muzzle.scale.set(1.05, 0.82, 1.25);
    muzzle.position.set(0, -R * 0.3, R * 0.8);
    head.add(muzzle);

    const nose = ball(R * 0.17, 0x2b2429, "wet", 14);
    nose.scale.set(1.3, 0.95, 0.85);
    nose.position.set(0, -R * 0.14, R * 1.3);
    head.add(nose);

    /* The mouth line, and a suggestion of a tongue behind it. */
    const mouth = part(roundedBox(R * 0.3, R * 0.05, R * 0.09, R * 0.025, 2), 0x40282c, "fur", 0, -R * 0.5, R * 1.16);
    mouth.castShadow = false;
    head.add(mouth);

    /* ---- eyes ----
       Big, wet, and set well forward. The white sphere reads as an eye; the
       highlight is what makes it read as alive. */
    const eyes = [];
    for (const side of [-1, 1]) {
        const socket = new THREE.Group();
        socket.position.set(side * R * 0.37, R * 0.13, R * 0.79);
        head.add(socket);

        /* A dark rim just behind the eyeball. Without it a white sclera on
           white fur has no edge at all, and Marshall ends up with two faint
           smudges where his eyes should be. */
        const rim = ball(R * 0.29, 0x3b2f2b, "fur", 14);
        rim.scale.set(0.96, 1.08, 0.8);
        rim.castShadow = false;
        socket.add(rim);

        const white = ball(R * 0.275, 0xfdfdff, "wet", 18);
        white.scale.set(0.94, 1.06, 0.85);
        socket.add(white);

        /* Iris and pupil both large: the single biggest lever on how young and
           how friendly a stylised animal reads is how much of the eye is dark. */
        const iris = ball(R * 0.185, 0x4a2c15, "wet", 16);
        iris.scale.set(1, 1, 0.45);
        iris.position.set(side * R * 0.02, -R * 0.01, R * 0.18);
        socket.add(iris);

        const pupil = ball(R * 0.115, 0x120e0d, "wet", 14);
        pupil.scale.set(1, 1, 0.45);
        pupil.position.set(side * R * 0.02, -R * 0.01, R * 0.22);
        socket.add(pupil);

        /* Two highlights, one big and one small, both offset the same way on
           both eyes — a highlight that mirrors between the eyes looks wrong
           and nobody can say why. */
        const glint = ball(R * 0.075, 0xffffff, "wet", 10);
        glint.position.set(-R * 0.075, R * 0.09, R * 0.24);
        glint.castShadow = false;
        socket.add(glint);
        const glint2 = ball(R * 0.03, 0xffffff, "wet", 8);
        glint2.position.set(R * 0.08, -R * 0.07, R * 0.23);
        glint2.castShadow = false;
        socket.add(glint2);

        /* The lid rides above the eye and drops to close it. Slightly larger
           than the eyeball so a closed lid covers it completely. */
        const lid = ball(R * 0.305, look.fur, "fur", 14);
        lid.scale.set(0.96, 1.08, 0.9);
        lid.position.y = R * 0.36;
        socket.add(lid);

        eyes.push({ socket, lid, open: R * 0.36 });
    }

    /* Brows, in the marking colour: the single cheapest way to give a face an
       expression it did not have. */
    for (const side of [-1, 1]) {
        const brow = part(
            roundedBox(R * 0.26, R * 0.055, R * 0.09, R * 0.025, 2),
            look.mark,
            "fur",
            side * R * 0.37,
            R * 0.45,
            R * 0.76
        );
        /* Outer end up, inner end down. The opposite — which is what a
           symmetric slab defaults to — is the universal cartoon shorthand for
           cross, and it is remarkable how stern a friendly dog looks with it. */
        brow.rotation.z = side * 0.2;
        brow.castShadow = false;
        head.add(brow);
    }

    /* ---- ears ----
       Two joints each, so they can flop rather than swing as one rigid flap. */
    const ears = [];
    for (const side of [-1, 1]) {
        const root = new THREE.Group();
        root.position.set(side * R * 0.8, R * 0.2, R * 0.02);
        root.rotation.z = side * 0.68;
        root.rotation.x = -0.1;
        root.rotation.y = side * -0.3;
        head.add(root);

        const upper = slab(R * 0.3, R * 0.6, R * 0.4, look.mark, "fur", R * 0.13);
        upper.position.y = -R * 0.29;
        root.add(upper);

        const hinge = new THREE.Group();
        hinge.position.y = -R * 0.58;
        root.add(hinge);

        const lower = slab(R * 0.25, R * 0.5, R * 0.34, look.mark, "fur", R * 0.11);
        lower.position.y = -R * 0.24;
        hinge.add(lower);

        /* A paler inner ear, so the flap has a front and a back. */
        const inner = slab(R * 0.04, R * 0.32, R * 0.18, look.muzzle, "fur", R * 0.02);
        inner.position.set(side * -R * 0.13, -R * 0.24, 0);
        inner.castShadow = false;
        hinge.add(inner);

        ears.push({ root, hinge, side });
    }

    /* ---- cap ---- */
    if (options.cap !== false) {
        const cap = new THREE.Group();
        cap.position.y = R * 0.62;
        head.add(cap);

        const dome = part(
            new THREE.SphereGeometry(R * 0.86, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.56),
            pup.colour,
            "kit"
        );
        dome.scale.set(1.02, 0.62, 1.02);
        cap.add(dome);

        const band = part(new THREE.TorusGeometry(R * 0.85, R * 0.06, 8, 24), pup.trim, "kit");
        band.rotation.x = Math.PI / 2;
        band.position.y = -R * 0.02;
        cap.add(band);

        const brim = slab(R * 1.05, R * 0.08, R * 0.66, pup.colour, "kit", R * 0.035);
        brim.position.set(0, -R * 0.04, R * 0.78);
        brim.rotation.x = -0.16;
        cap.add(brim);

        const badge = part(pawGeometry(R * 0.6, R * 0.045), 0xffffff, "kit", 0, R * 0.16, R * 0.64);
        badge.rotation.x = -0.55;
        cap.add(badge);
    }

    /* ---- breed markings ---- */
    const look3 = look.pattern;
    if (look3 === "spots") {
        const spots = [
            [-0.55, 0.5, 0.6],
            [0.62, 0.28, 0.55],
            [-0.3, -0.5, 0.72],
            [0.75, -0.3, 0.4],
            [-0.8, 0.05, 0.2],
        ];
        spots.forEach(([x, y, z], i) =>
            marking(head, R, new THREE.Vector3(x, y, z), R * (0.16 + (i % 3) * 0.04), look.mark)
        );
    } else if (look3 === "saddle") {
        marking(head, R, new THREE.Vector3(0, 0.75, -0.4), R * 0.4, look.mark, 0.28);
    } else if (look3 === "husky") {
        for (const side of [-1, 1]) {
            marking(head, R, new THREE.Vector3(side * 0.55, 0.55, 0.5), R * 0.24, look.mark, 0.25);
        }
    } else if (look3 === "patch") {
        marking(head, R, new THREE.Vector3(-0.6, 0.3, 0.62), R * 0.26, look.mark, 0.25);
    }

    head.userData = { eyes, ears, skull, muzzle };
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
    const chest = capsule(0.185, 0.2, look.fur, "fur", 16);
    chest.rotation.x = Math.PI / 2;
    chest.position.set(0, 0.02, 0.08);
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
    const ruff = ball(0.135, look.fur, "fur", 14);
    ruff.scale.set(1, 0.95, 0.8);
    ruff.position.set(0, 0.07, 0.17);
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
            spot.position.set(dir.x * 0.175, dir.y * 0.15 - 0.01, dir.z * 0.24 - 0.05);
            spot.scale.set(1, 0.6, 1);
            spot.castShadow = false;
            hide.add(spot);
        });
    } else if (look.pattern === "saddle" || look.pattern === "husky") {
        /* A darker coat over the back and shoulders, stopping short of the
           belly. Two spheres rather than one so it follows the body's line. */
        const back = ball(0.183, look.mark, "fur", 16);
        back.scale.set(0.97, 0.78, 1.05);
        back.position.set(0, 0.035, 0.06);
        back.castShadow = false;
        hide.add(back);
        const rump = ball(0.175, look.mark, "fur", 16);
        rump.scale.set(0.97, 0.72, 1.1);
        rump.position.set(0, 0.03, -0.2);
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
    neck.position.set(0, 0.11, 0.19);
    root.add(neck);

    const head = buildPupHead(pup);
    head.scale.setScalar(0.95);
    head.position.set(0, 0.17, 0.07);
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
            ear.root.rotation.x = this.earPitch * 0.55;
            ear.hinge.rotation.x = this.earPitch;
            ear.hinge.rotation.z = ear.side * this.earPitch * 0.2;
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
            eyes[i].lid.position.y = eyes[i].open * (1 - shut);
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

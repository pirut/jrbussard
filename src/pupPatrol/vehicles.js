/*
 * The roster: seven pups, seven very different things to drive.
 *
 * The point of giving each one its own numbers is that swapping pup should
 * change how the island feels, not just what colour it is. Rubble cannot be
 * hurried and does not care; Zuma is the only one who treats the bay as a
 * road; Skye ignores the road network entirely. Missions ask for a specific
 * pup often enough that you end up learning all of them.
 */

import * as THREE from "three";
import { roundedBox, tyreGeometry, canopyGeometry, barGeometry, pawGeometry, wedgeGeometry } from "./geometry";

/* --------------------------------------------------------------- *
 * Shared spec defaults
 * --------------------------------------------------------------- */

const CAR_BASE = {
    kind: "car",
    mass: 1250,
    size: new THREE.Vector3(2.1, 1.5, 4.3),
    suspensionRest: 0.42,
    suspensionTravel: 0.34,
    suspensionStiffness: 42000,
    suspensionDamping: 3600,
    suspensionMaxForce: 110000,
    engineForce: 16000,
    brakeForce: 28000,
    maxSpeed: 34,
    steerMax: 0.62,
    steerSpeed: 5.0,
    steerFalloff: 42,
    grip: 1.35,
    lateralGrip: 0.85,
    rollingResistance: 55,
    drag: 3.0,
    downforce: 3.0,
    linearDamping: 0.05,
    angularDamping: 1.35,
    antiRoll: 16000,
    /* Pitch, yaw, roll inertia multipliers.
     *
     * A solid box of a car's dimensions has almost no resistance to rolling —
     * about 560 kg m^2 — while the cornering forces act a metre below the
     * centre of mass. Left at the box value, any real corner produces a roll
     * acceleration of sixty radians per second squared and the thing lies
     * down. Real cars carry their mass low and spread along the length, so
     * roll inertia is several times what the box says. */
    inertiaScale: new THREE.Vector3(1.9, 1.15, 3.4),
    /* 0 puts grip at the contact patch, 1 at the centre of mass. See the note
       in physics.js — this is what keeps corners on four wheels. */
    rollCentre: 0.72,
    uprightAssist: 26,
    rollDamping: 4.5,
    airControl: 1.0,
    chassisClearance: 0.55,
    spawnHeight: 1.35,
    buoyancy: 0.86,
    waterDrag: 2.6,
};

function carWheels({ track = 0.92, front = 1.45, rear = -1.42, y = -0.34, radius = 0.45, awd = false } = {}) {
    /* Order matters: the anti-roll bar pairs wheels 0/1 and 2/3. */
    return [
        { x: -track, y, z: front, radius, steering: true, powered: awd },
        { x: track, y, z: front, radius, steering: true, powered: awd },
        { x: -track, y, z: rear, radius, powered: true, handbrake: true },
        { x: track, y, z: rear, radius, powered: true, handbrake: true },
    ];
}

/* --------------------------------------------------------------- *
 * The pups
 * --------------------------------------------------------------- */

export const PUPS = [
    {
        id: "chase",
        name: "Chase",
        job: "Police pup",
        catchphrase: "Chase is on the case!",
        colour: 0x2f6fe0,
        accent: 0xf2f5fb,
        trim: 0x14356f,
        vehicle: "Police Cruiser",
        ability: "siren",
        abilityName: "Siren",
        abilityHint: "Clears the road and calls people out to meet you",
        blurb: "Quickest thing on tarmac. Sticks to the road like it owes him money.",
        spec: {
            ...CAR_BASE,
            mass: 1180,
            size: new THREE.Vector3(2.0, 1.32, 4.3),
            engineForce: 18500,
            maxSpeed: 40,
            grip: 1.45,
            lateralGrip: 0.95,
            downforce: 4.2,
            steerMax: 0.6,
            wheels: carWheels({ track: 0.9, front: 1.44, rear: -1.4, radius: 0.42, y: -0.3 }),
        },
    },
    {
        id: "marshall",
        name: "Marshall",
        job: "Fire pup",
        catchphrase: "I'm fired up!",
        colour: 0xe0392b,
        accent: 0xf7f7f7,
        trim: 0x8c1a10,
        vehicle: "Fire Engine",
        ability: "water",
        abilityName: "Water cannon",
        abilityHint: "Hold to put out fires",
        blurb: "Heavy, tall and slow to turn. The only one who can put a fire out.",
        spec: {
            ...CAR_BASE,
            mass: 2400,
            size: new THREE.Vector3(2.4, 2.4, 5.8),
            engineForce: 24000,
            brakeForce: 38000,
            maxSpeed: 27,
            grip: 1.25,
            lateralGrip: 0.72,
            steerMax: 0.5,
            steerSpeed: 3.4,
            antiRoll: 42000,
            /* Tall and heavy: even more reluctant to lie over. */
            inertiaScale: new THREE.Vector3(1.9, 1.15, 4.6),
            rollCentre: 0.78,
            suspensionStiffness: 76000,
            suspensionDamping: 6400,
            chassisClearance: 0.7,
            spawnHeight: 1.7,
            wheels: carWheels({ track: 1.05, front: 1.95, rear: -1.85, radius: 0.58, y: -0.5 }),
        },
    },
    {
        id: "skye",
        name: "Skye",
        job: "Air rescue",
        catchphrase: "Let's take to the sky!",
        colour: 0xff77c0,
        accent: 0xfff0f8,
        trim: 0xb03a7c,
        vehicle: "Helicopter",
        ability: "winch",
        abilityName: "Winch",
        abilityHint: "Hover low over someone to lift them out",
        blurb: "Goes over everything. Roads are for other people.",
        spec: {
            kind: "heli",
            mass: 900,
            size: new THREE.Vector3(2.2, 2.2, 6.4),
            rotorMax: 34,
            climbPower: 0.85,
            maxTilt: 0.44,
            tiltResponse: 3.0,
            yawRate: 1.5,
            dragForward: 0.55,
            dragSide: 2.6,
            dragVertical: 1.5,
            ceiling: 210,
            spawnHeight: 1.1,
            maxSpeed: 42,
        },
    },
    {
        id: "rubble",
        name: "Rubble",
        job: "Construction pup",
        catchphrase: "Rubble on the double!",
        colour: 0xf6c31f,
        accent: 0x3a3a3a,
        trim: 0xa8810a,
        vehicle: "Bulldozer",
        ability: "plough",
        abilityName: "Blade",
        abilityHint: "Shove rocks and rubble out of the way",
        blurb: "Never hurries and never gets stuck. Drives straight over things.",
        spec: {
            ...CAR_BASE,
            mass: 3200,
            size: new THREE.Vector3(2.6, 2.2, 4.8),
            engineForce: 30000,
            brakeForce: 44000,
            maxSpeed: 18,
            grip: 1.7,
            lateralGrip: 1.05,
            steerMax: 0.72,
            steerSpeed: 3.0,
            steerFalloff: 26,
            antiRoll: 55000,
            inertiaScale: new THREE.Vector3(1.9, 1.15, 4.8),
            rollCentre: 0.8,
            suspensionStiffness: 105000,
            suspensionDamping: 9000,
            suspensionTravel: 0.42,
            rollingResistance: 110,
            chassisClearance: 0.85,
            spawnHeight: 1.75,
            downforce: 1.0,
            wheels: carWheels({ track: 1.15, front: 1.5, rear: -1.5, radius: 0.72, y: -0.42, awd: true }),
        },
    },
    {
        id: "rocky",
        name: "Rocky",
        job: "Recycling pup",
        catchphrase: "Green means go!",
        colour: 0x49a84c,
        accent: 0xdfeeda,
        trim: 0x24632a,
        vehicle: "Recycling Truck",
        ability: "tow",
        abilityName: "Tow hook",
        abilityHint: "Hook a stranded vehicle and drag it home",
        blurb: "Middle of the road in every way, which makes him the safe pick.",
        spec: {
            ...CAR_BASE,
            mass: 1750,
            size: new THREE.Vector3(2.2, 2.0, 5.0),
            engineForce: 19000,
            maxSpeed: 30,
            grip: 1.32,
            lateralGrip: 0.8,
            steerMax: 0.56,
            antiRoll: 14000,
            suspensionStiffness: 58000,
            suspensionDamping: 4800,
            chassisClearance: 0.62,
            spawnHeight: 1.5,
            wheels: carWheels({ track: 0.98, front: 1.65, rear: -1.6, radius: 0.5, y: -0.42 }),
        },
    },
    {
        id: "zuma",
        name: "Zuma",
        job: "Water rescue",
        catchphrase: "Ready, set, get wet!",
        colour: 0xff8b3d,
        accent: 0xfff1e2,
        trim: 0xa8501a,
        vehicle: "Hovercraft",
        ability: "float",
        abilityName: "Skirt",
        abilityHint: "Crosses water at full speed",
        blurb: "Treats the bay as a shortcut. Vague on land, unbeatable on water.",
        spec: {
            ...CAR_BASE,
            mass: 1050,
            size: new THREE.Vector3(2.6, 1.4, 4.6),
            engineForce: 14500,
            brakeForce: 12000,
            maxSpeed: 33,
            grip: 0.9,
            lateralGrip: 0.42,
            steerMax: 0.7,
            steerSpeed: 4.0,
            rollingResistance: 22,
            suspensionRest: 0.55,
            suspensionTravel: 0.4,
            suspensionStiffness: 30000,
            suspensionDamping: 2600,
            antiRoll: 4000,
            /* The whole trick: it floats high and barely slows in water. */
            buoyancy: 1.06,
            waterDrag: 0.35,
            chassisClearance: 0.5,
            spawnHeight: 1.3,
            wheels: carWheels({ track: 1.1, front: 1.5, rear: -1.5, radius: 0.4, y: -0.28, awd: true }),
        },
    },
    {
        id: "everest",
        name: "Everest",
        job: "Snow rescue",
        catchphrase: "Ice or snow, I'm ready to go!",
        colour: 0x3fbdd4,
        accent: 0xeafaff,
        trim: 0x1c6f80,
        vehicle: "Snow Cat",
        ability: "plough",
        abilityName: "Snow blade",
        abilityHint: "Grips where nothing else will",
        blurb: "Built for the mountain. Take her up the Summit Trail and nothing else compares.",
        spec: {
            ...CAR_BASE,
            mass: 2000,
            size: new THREE.Vector3(2.5, 2.0, 5.0),
            engineForce: 23000,
            maxSpeed: 25,
            grip: 1.85,
            lateralGrip: 1.15,
            steerMax: 0.66,
            steerSpeed: 3.6,
            antiRoll: 20000,
            suspensionStiffness: 72000,
            suspensionDamping: 6000,
            suspensionTravel: 0.44,
            chassisClearance: 0.8,
            spawnHeight: 1.7,
            wheels: carWheels({ track: 1.12, front: 1.6, rear: -1.6, radius: 0.62, y: -0.4, awd: true }),
        },
    },
];

export const pupById = (id) => PUPS.find((p) => p.id === id) || PUPS[0];

/* --------------------------------------------------------------- *
 * Mesh construction
 *
 * Everything is built from rounded stock — no raw BoxGeometry anywhere on a
 * vehicle. The show's trucks are moulded toys: soft corners, deep gloss, a
 * wraparound bubble canopy and wheels far too big for the body. Reproducing
 * that proportion is most of the job; the rest is that every panel gets a
 * highlight because nothing is flat.
 * --------------------------------------------------------------- */

const materialCache = new Map();

function mat(color, opts = {}) {
    const key = `${color}|${JSON.stringify(opts)}`;
    let m = materialCache.get(key);
    if (!m) {
        m = new THREE.MeshStandardMaterial({
            color,
            /* Toy plastic: smooth, a little metallic sparkle in the paint. */
            roughness: opts.roughness ?? 0.34,
            metalness: opts.metalness ?? 0.12,
            emissive: opts.emissive ?? 0x000000,
            emissiveIntensity: opts.emissiveIntensity ?? 1,
            transparent: opts.transparent ?? false,
            opacity: opts.opacity ?? 1,
            side: opts.side ?? THREE.FrontSide,
            flatShading: opts.flatShading ?? false,
        });
        materialCache.set(key, m);
    }
    return m;
}

const PAINT = { roughness: 0.28, metalness: 0.2 };
const CHROME = { roughness: 0.16, metalness: 0.9 };
const RUBBER = { roughness: 0.88, metalness: 0.02 };
const GLASS = { roughness: 0.06, metalness: 0.35, transparent: true, opacity: 0.55 };

function mesh(geometry, color, opts) {
    const m = new THREE.Mesh(geometry, mat(color, opts));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

function rbox(w, h, d, color, x = 0, y = 0, z = 0, opts, radius) {
    const m = mesh(roundedBox(w, h, d, radius ?? Math.min(w, h, d) * 0.3), color, opts);
    m.position.set(x, y, z);
    return m;
}

function cyl(rTop, rBottom, h, color, segments = 18, opts) {
    return mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), color, opts);
}

function sphere(r, color, opts, segments = 16) {
    return mesh(new THREE.SphereGeometry(r, segments, Math.round(segments * 0.7)), color, opts);
}

/* A wheel: fat rounded tyre, dished rim, chrome hub. */
function buildWheel(radius, width, rimColor) {
    const group = new THREE.Group();

    const tyre = mesh(tyreGeometry(radius, width), 0x23232a, RUBBER);
    group.add(tyre);

    const rim = cyl(radius * 0.62, radius * 0.62, width * 0.86, rimColor, 16, CHROME);
    rim.rotation.z = Math.PI / 2;
    group.add(rim);

    const hub = cyl(radius * 0.2, radius * 0.24, width * 1.02, 0xf2f5f8, 12, CHROME);
    hub.rotation.z = Math.PI / 2;
    group.add(hub);

    /* Five spokes, so a spinning wheel actually reads as spinning. */
    for (let i = 0; i < 5; i += 1) {
        const spoke = mesh(roundedBox(width * 0.7, radius * 0.86, radius * 0.2, radius * 0.08, 2), rimColor, CHROME);
        spoke.rotation.x = (i / 5) * Math.PI;
        group.add(spoke);
    }

    return group;
}

/* Head and shoulders of the pup at the wheel. */
function buildDriver(pup) {
    const group = new THREE.Group();
    const fur = pup.id === "marshall" ? 0xf7f2e8 : pup.id === "rubble" ? 0xdaa94c : 0xecdcbf;

    const head = sphere(0.34, fur, { roughness: 0.72, metalness: 0 });
    head.scale.set(1, 0.95, 1.06);
    head.position.y = 0.26;
    group.add(head);

    const snout = sphere(0.18, fur, { roughness: 0.72, metalness: 0 });
    snout.scale.set(0.92, 0.72, 1.28);
    snout.position.set(0, 0.17, 0.3);
    group.add(snout);

    const nose = sphere(0.075, 0x2a2320, { roughness: 0.4 }, 10);
    nose.position.set(0, 0.22, 0.44);
    group.add(nose);

    for (const side of [-1, 1]) {
        const ear = rbox(0.11, 0.26, 0.17, pup.trim, side * 0.29, 0.32, -0.02, { roughness: 0.7 }, 0.05);
        ear.rotation.z = side * 0.34;
        group.add(ear);

        const eye = sphere(0.068, 0xffffff, { roughness: 0.2 }, 10);
        eye.position.set(side * 0.13, 0.31, 0.26);
        eye.scale.set(1, 1.1, 0.6);
        group.add(eye);
        const pupil = sphere(0.04, 0x14141a, { roughness: 0.2 }, 8);
        pupil.position.set(side * 0.14, 0.3, 0.3);
        group.add(pupil);
    }

    /* Cap in the pup's colour. */
    const cap = sphere(0.31, pup.colour, PAINT, 16);
    cap.scale.set(1, 0.56, 1);
    cap.position.y = 0.46;
    group.add(cap);
    const peak = rbox(0.44, 0.06, 0.24, pup.colour, 0, 0.42, 0.27, PAINT, 0.03);
    group.add(peak);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.055, 8, 18), mat(pup.colour, PAINT));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.02;
    collar.castShadow = true;
    group.add(collar);

    const tag = mesh(pawGeometry(0.34, 0.05), 0xffd83d, { roughness: 0.3, metalness: 0.4 });
    tag.position.set(0, -0.05, 0.25);
    group.add(tag);

    return group;
}

/* The light bar: chrome frame with two dome lamps that flash. */
function buildLightBar(pup, width) {
    const group = new THREE.Group();
    group.add(rbox(width, 0.12, 0.26, 0x2f333c, 0, 0, 0, CHROME, 0.05));

    const lamps = [];
    for (const side of [-1, 1]) {
        const colour = side < 0 ? 0xff2f22 : 0x2f6fe0;
        const lamp = sphere(0.13, colour, {
            emissive: colour,
            emissiveIntensity: 0.25,
            roughness: 0.18,
            metalness: 0.1,
        }, 14);
        lamp.scale.set(width * 0.24, 0.85, 1);
        lamp.position.set(side * width * 0.26, 0.08, 0);
        group.add(lamp);
        lamps.push(lamp);
    }
    group.userData.lamps = lamps;
    return group;
}

function buildCar(pup) {
    const group = new THREE.Group();
    const { size } = pup.spec;
    const w = size.x;
    const h = size.y;
    const l = size.z;

    /* Lower body: a deep rounded tub. */
    const body = rbox(w, h * 0.62, l, pup.colour, 0, -h * 0.02, 0, PAINT, Math.min(w, h) * 0.28);
    group.add(body);

    /* Cab: narrower, sitting on top and set back. */
    const cab = rbox(w * 0.84, h * 0.56, l * 0.46, pup.colour, 0, h * 0.42, -l * 0.04, PAINT, h * 0.2);
    group.add(cab);

    /* Wraparound bubble glass — the signature shape. */
    const glass = mesh(canopyGeometry(w * 0.86, h * 0.74, l * 0.52), 0x1c3348, GLASS);
    glass.position.set(0, h * 0.3, -l * 0.02);
    group.add(glass);

    /* Belt-line stripe in the accent colour. */
    const stripe = rbox(w * 1.015, h * 0.15, l * 0.78, pup.accent, 0, h * 0.06, 0, { roughness: 0.3 }, 0.06);
    group.add(stripe);

    /* Chrome bumpers with a bit of overhang. */
    group.add(mesh(barGeometry(w * 1.02, h * 0.2, 0.3), 0xd7dde4, CHROME).translateY(-h * 0.2).translateZ(l * 0.49));
    group.add(mesh(barGeometry(w * 1.02, h * 0.2, 0.3), 0xd7dde4, CHROME).translateY(-h * 0.2).translateZ(-l * 0.49));

    /* Running boards. */
    for (const side of [-1, 1]) {
        group.add(rbox(0.16, 0.12, l * 0.5, pup.trim, side * w * 0.52, -h * 0.28, 0, { roughness: 0.6 }, 0.05));
    }

    /* The paw badge on both doors. */
    for (const side of [-1, 1]) {
        const badge = mesh(pawGeometry(0.62, 0.06), 0xffffff, { roughness: 0.3 });
        badge.position.set(side * (w * 0.5 + 0.02), h * 0.06, -l * 0.04);
        badge.rotation.y = side * Math.PI * 0.5;
        group.add(badge);
    }

    /* Lights. */
    const headlights = [];
    for (const side of [-1, 1]) {
        const lamp = sphere(0.15, 0xfff8e0, { emissive: 0xfff0c0, emissiveIntensity: 0.5, roughness: 0.1 }, 12);
        lamp.scale.set(1.25, 0.9, 0.55);
        lamp.position.set(side * w * 0.31, h * 0.04, l * 0.5);
        group.add(lamp);
        headlights.push(lamp);

        const tail = sphere(0.12, 0xe0281b, { emissive: 0xff2a1a, emissiveIntensity: 0.4, roughness: 0.1 }, 12);
        tail.scale.set(1.2, 0.9, 0.5);
        tail.position.set(side * w * 0.31, h * 0.08, -l * 0.5);
        group.add(tail);
    }

    const driver = buildDriver(pup);
    driver.position.set(0, h * 0.46, l * 0.02);
    driver.scale.setScalar(0.92);
    group.add(driver);

    const lightBar = buildLightBar(pup, w * 0.7);
    lightBar.position.set(0, h * 0.74, -l * 0.06);
    group.add(lightBar);

    /* --- what makes each one unmistakably whose it is --- */
    const extras = new THREE.Group();

    if (pup.id === "marshall") {
        const ladder = new THREE.Group();
        for (const side of [-1, 1]) {
            ladder.add(rbox(0.1, 0.1, l * 0.9, 0xd9dee4, side * 0.22, 0, 0, CHROME, 0.04));
        }
        for (let i = -4; i <= 4; i += 1) {
            ladder.add(rbox(0.5, 0.07, 0.07, 0xd9dee4, 0, 0, i * (l * 0.095), CHROME, 0.03));
        }
        ladder.position.set(0, h * 0.78, -l * 0.02);
        ladder.rotation.x = -0.1;
        extras.add(ladder);

        const tank = cyl(0.44, 0.44, l * 0.42, 0xf4f6f8, 18, { roughness: 0.25, metalness: 0.5 });
        tank.rotation.z = Math.PI / 2;
        tank.position.set(0, -h * 0.04, -l * 0.3);
        extras.add(tank);

        /* Water cannon on the nose. */
        const cannon = cyl(0.1, 0.13, 0.8, 0xd7dde4, 12, CHROME);
        cannon.rotation.x = Math.PI / 2 - 0.25;
        cannon.position.set(0, h * 0.34, l * 0.44);
        extras.add(cannon);
    } else if (pup.id === "rubble") {
        const blade = mesh(roundedBox(w * 1.55, h * 0.78, 0.24, 0.1, 3), 0xc9ced4, CHROME);
        blade.position.set(0, -h * 0.1, l * 0.74);
        blade.rotation.x = 0.2;
        extras.add(blade);
        for (const side of [-1, 1]) {
            extras.add(rbox(0.18, 0.18, 0.95, pup.trim, side * w * 0.38, -h * 0.16, l * 0.5, PAINT, 0.07));
        }
        const beacon = sphere(0.17, 0xffb114, { emissive: 0xff9500, emissiveIntensity: 0.8, roughness: 0.15 }, 12);
        beacon.position.set(0, h * 0.92, -l * 0.06);
        extras.add(beacon);
    } else if (pup.id === "rocky") {
        const hopper = rbox(w * 0.92, h * 0.6, l * 0.46, pup.trim, 0, h * 0.46, -l * 0.26, PAINT, 0.14);
        extras.add(hopper);
        const arm = rbox(0.18, 0.18, 1.6, 0xa8b0b8, 0, h * 0.92, -l * 0.34, CHROME, 0.07);
        arm.rotation.x = -0.5;
        extras.add(arm);
        const hook = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.05, 8, 14), mat(0xe2e7ec, CHROME));
        hook.position.set(0, h * 1.22, -l * 0.74);
        hook.castShadow = true;
        extras.add(hook);
    } else if (pup.id === "everest") {
        const blade = mesh(roundedBox(w * 1.5, h * 0.62, 0.22, 0.09, 3), 0xe7f1f6, CHROME);
        blade.position.set(0, -h * 0.08, l * 0.72);
        blade.rotation.x = 0.26;
        extras.add(blade);
        const rack = rbox(w * 0.72, 0.1, l * 0.46, pup.trim, 0, h * 0.8, -l * 0.1, PAINT, 0.04);
        extras.add(rack);
        for (const side of [-1, 1]) {
            extras.add(rbox(0.16, 0.09, 1.8, 0xff5a5a, side * 0.25, h * 0.88, -l * 0.1, PAINT, 0.04));
        }
    } else if (pup.id === "zuma") {
        const skirt = new THREE.Mesh(new THREE.TorusGeometry(w * 0.6, 0.34, 12, 26), mat(0x33373f, RUBBER));
        skirt.rotation.x = Math.PI / 2;
        skirt.scale.set(1, l / (w * 1.35), 1);
        skirt.position.y = -h * 0.32;
        skirt.castShadow = true;
        extras.add(skirt);

        const duct = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.12, 10, 22), mat(pup.trim, PAINT));
        duct.position.set(0, h * 0.4, -l * 0.52);
        duct.castShadow = true;
        extras.add(duct);

        const fan = new THREE.Group();
        for (let i = 0; i < 5; i += 1) {
            const blade = rbox(0.1, 0.54, 0.07, 0xe3e7ec, 0, 0, 0, CHROME, 0.03);
            const a = (i / 5) * Math.PI * 2;
            blade.rotation.z = a;
            blade.position.set(Math.sin(a) * 0.28, Math.cos(a) * 0.28, 0);
            fan.add(blade);
        }
        fan.position.set(0, h * 0.4, -l * 0.52);
        extras.add(fan);
        group.userData.fan = fan;
    } else if (pup.id === "chase") {
        /* Police spoiler and push bar. */
        const spoiler = rbox(w * 0.88, 0.09, 0.38, pup.trim, 0, h * 0.42, -l * 0.53, PAINT, 0.04);
        extras.add(spoiler);
        for (const side of [-1, 1]) {
            extras.add(rbox(0.1, 0.32, 0.1, pup.trim, side * w * 0.34, h * 0.26, -l * 0.53, PAINT, 0.04));
        }
        const push = rbox(w * 0.8, 0.14, 0.14, 0xd7dde4, 0, -h * 0.1, l * 0.56, CHROME, 0.06);
        extras.add(push);
        const megaphone = cyl(0.1, 0.16, 0.26, 0xd7dde4, 12, CHROME);
        megaphone.rotation.x = Math.PI / 2;
        megaphone.position.set(-w * 0.22, h * 0.72, l * 0.06);
        extras.add(megaphone);
    }
    group.add(extras);

    const wheelMeshes = pup.spec.wheels.map((w2) => {
        const wheel = buildWheel(w2.radius, w2.radius * 0.72, pup.accent);
        group.add(wheel);
        return wheel;
    });

    group.userData.wheels = wheelMeshes;
    group.userData.lightBar = lightBar;
    group.userData.headlights = headlights;
    group.userData.driver = driver;
    return group;
}

function buildHelicopter(pup) {
    const group = new THREE.Group();
    const { size } = pup.spec;

    /* Teardrop cabin. */
    const body = sphere(1.08, pup.colour, PAINT, 22);
    body.scale.set(1, 0.98, 1.55);
    body.position.z = 0.35;
    group.add(body);

    const nose = sphere(0.78, pup.colour, PAINT, 18);
    nose.scale.set(0.95, 0.85, 1.1);
    nose.position.set(0, -0.1, 1.5);
    group.add(nose);

    /* Big bubble canopy. */
    const glass = mesh(canopyGeometry(1.9, 1.5, 2.5, Math.PI * 1.5), 0x1d3247, GLASS);
    glass.position.set(0, 0.12, 0.75);
    group.add(glass);

    const tail = rbox(0.42, 0.42, size.z * 0.66, pup.colour, 0, 0.28, -size.z * 0.44, PAINT, 0.16);
    group.add(tail);
    const fin = mesh(wedgeGeometry(0.9, 1.1, 0.14), pup.trim, PAINT);
    fin.position.set(0, 0.85, -size.z * 0.7);
    group.add(fin);
    const stab = rbox(1.7, 0.11, 0.46, pup.trim, 0, 0.32, -size.z * 0.62, PAINT, 0.05);
    group.add(stab);

    /* Main rotor. */
    const rotor = new THREE.Group();
    rotor.add(cyl(0.2, 0.2, 0.3, 0x3b4046, 12, CHROME));
    for (let i = 0; i < 4; i += 1) {
        const blade = rbox(0.36, 0.06, 8.0, 0x2f343a, 0, 0.06, 0, { roughness: 0.5 }, 0.03);
        const a = (i / 4) * Math.PI * 2;
        blade.rotation.y = a;
        blade.position.set(Math.sin(a) * 3.9, 0.06, Math.cos(a) * 3.9);
        rotor.add(blade);
        const tip = sphere(0.09, pup.accent, PAINT, 8);
        tip.position.set(Math.sin(a) * 7.8, 0.06, Math.cos(a) * 7.8);
        rotor.add(tip);
    }
    rotor.position.set(0, 1.3, 0.3);
    group.add(rotor);

    const mast = cyl(0.14, 0.17, 0.62, 0x9aa1a8, 10, CHROME);
    mast.position.set(0, 1.0, 0.3);
    group.add(mast);

    const tailRotor = new THREE.Group();
    for (let i = 0; i < 3; i += 1) {
        const blade = rbox(0.07, 1.5, 0.16, 0x2f343a, 0, 0, 0, { roughness: 0.5 }, 0.03);
        const a = (i / 3) * Math.PI * 2;
        blade.rotation.z = a;
        blade.position.set(Math.sin(a) * 0.74, Math.cos(a) * 0.74, 0);
        tailRotor.add(blade);
    }
    tailRotor.position.set(0.3, 0.58, -size.z * 0.7);
    group.add(tailRotor);

    /* Skids. */
    for (const side of [-1, 1]) {
        const skid = rbox(0.14, 0.14, 3.5, 0xd2d8de, side * 0.95, -1.08, 0.3, CHROME, 0.06);
        group.add(skid);
        const tip = sphere(0.1, 0xd2d8de, CHROME, 10);
        tip.position.set(side * 0.95, -1.02, 2.1);
        group.add(tip);
        group.add(rbox(0.11, 0.66, 0.11, 0xd2d8de, side * 0.82, -0.74, 1.3, CHROME, 0.05));
        group.add(rbox(0.11, 0.66, 0.11, 0xd2d8de, side * 0.82, -0.74, -0.7, CHROME, 0.05));
    }

    /* Paw badge on the tail. */
    const badge = mesh(pawGeometry(0.7, 0.06), 0xffffff, { roughness: 0.3 });
    badge.position.set(0.23, 0.3, -size.z * 0.44);
    badge.rotation.y = Math.PI * 0.5;
    group.add(badge);

    const driver = buildDriver(pup);
    driver.position.set(0, 0.14, 1.0);
    driver.scale.setScalar(0.88);
    group.add(driver);

    const beacon = sphere(0.14, 0xff3b30, { emissive: 0xff2a1a, emissiveIntensity: 0.9, roughness: 0.1 }, 10);
    beacon.position.set(0, -0.98, 0.3);
    group.add(beacon);

    group.userData.rotor = rotor;
    group.userData.tailRotor = tailRotor;
    group.userData.wheels = [];
    group.userData.beacon = beacon;
    group.userData.driver = driver;
    return group;
}

export function buildVehicleMesh(pup) {
    const mesh2 = pup.spec.kind === "heli" ? buildHelicopter(pup) : buildCar(pup);
    mesh2.name = `vehicle-${pup.id}`;
    return mesh2;
}

export { mat as vehicleMaterial, rbox as vehicleBox, cyl as vehicleCylinder, sphere as vehicleSphere, PAINT, CHROME };

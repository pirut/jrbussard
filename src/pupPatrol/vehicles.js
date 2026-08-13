/*
 * The roster: seven pups, seven very different things to drive.
 *
 * The point of giving each one its own numbers is that swapping pup should
 * change how the island feels, not just what colour it is. Rubble cannot be
 * hurried and does not care; Zuma is the only one who treats the bay as a
 * road; Skye ignores the road network entirely. Missions ask for a specific
 * pup often enough that you end up learning all of them.
 *
 * The handling numbers are grouped by what they do rather than by where the
 * physics happens to read them: how much grip, how the grip lets go, how much
 * the car helps you when it does.
 */

import * as THREE from "three";
import { roundedBox, tyreGeometry, canopyGeometry, barGeometry, pawGeometry, wedgeGeometry } from "./geometry";
import { buildPupHead } from "./pups";

/* --------------------------------------------------------------- *
 * Shared spec defaults
 * --------------------------------------------------------------- */

const CAR_BASE = {
    kind: "car",
    mass: 1250,
    size: new THREE.Vector3(2.1, 1.5, 4.3),

    /* ---- suspension ---- */
    suspensionRest: 0.42,
    suspensionTravel: 0.34,
    suspensionStiffness: 42000,
    suspensionDamping: 3600,
    suspensionMaxForce: 110000,

    /* ---- drivetrain ---- */
    engineForce: 16000,
    brakeForce: 30000,
    maxSpeed: 34,
    maxRpm: 6400,
    idleRpm: 780,
    engineBrake: 0.11,

    /* ---- steering ---- */
    steerMax: 0.62,
    steerSpeed: 5.4,
    steerFalloff: 42,
    ackermann: 0.75,
    /* The most lateral acceleration a full-lock request is allowed to ask
       for. Above it the front tyres would simply give up, which reads as the
       steering having stopped working rather than as a limit being reached. */
    corneringLimit: 24,
    /* How much extra opposite lock the car gives you for free once the back
       steps out. Zero is authentic; this is a programme for five year olds. */
    counterSteer: 0.34,
    /* Gentle electronic hand on the yaw rate. Not enough to prevent a slide. */
    stability: 3.4,

    /* ---- tyres ---- */
    grip: 1.35,
    /* Where the grip curve peaks. Smaller is a sharper, more nervous tyre. */
    peakSlipRatio: 0.16,
    peakSlipAngle: 0.17,
    /* How much grip a tyre loses as it is loaded past its share of the weight.
       This is what makes weight transfer cost you something. */
    loadSensitivity: 0.18,
    rollingResistance: 55,

    /* ---- aero and body ---- */
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
            brakeForce: 34000,
            maxSpeed: 40,
            maxRpm: 7000,
            gears: [3.3, 2.05, 1.46, 1.1, 0.86, 0.72],
            grip: 1.48,
            peakSlipAngle: 0.15,
            downforce: 4.6,
            steerMax: 0.6,
            steerSpeed: 6.2,
            corneringLimit: 27,
            stability: 4.2,
            counterSteer: 0.3,
            antiRoll: 20000,
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
            engineForce: 26000,
            brakeForce: 42000,
            maxSpeed: 27,
            maxRpm: 4200,
            gears: [4.1, 2.4, 1.55, 1.0],
            grip: 1.24,
            peakSlipAngle: 0.2,
            loadSensitivity: 0.24,
            steerMax: 0.5,
            steerSpeed: 3.6,
            corneringLimit: 17,
            stability: 5.0,
            counterSteer: 0.42,
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
            maxTilt: 0.46,
            tiltResponse: 3.2,
            yawRate: 1.6,
            dragForward: 0.52,
            dragSide: 2.6,
            dragVertical: 1.5,
            gust: 0.6,
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
            engineForce: 34000,
            brakeForce: 48000,
            maxSpeed: 18,
            maxRpm: 2600,
            gears: [3.6, 1.9, 1.0],
            grip: 1.72,
            peakSlipAngle: 0.26,
            peakSlipRatio: 0.24,
            loadSensitivity: 0.1,
            steerMax: 0.72,
            steerSpeed: 3.2,
            steerFalloff: 26,
            corneringLimit: 15,
            stability: 6.0,
            counterSteer: 0.5,
            antiRoll: 55000,
            inertiaScale: new THREE.Vector3(1.9, 1.15, 4.8),
            rollCentre: 0.8,
            suspensionStiffness: 105000,
            suspensionDamping: 9000,
            suspensionTravel: 0.42,
            rollingResistance: 120,
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
            engineForce: 20500,
            maxSpeed: 30,
            maxRpm: 5200,
            gears: [3.6, 2.2, 1.5, 1.05, 0.84],
            grip: 1.32,
            peakSlipAngle: 0.185,
            steerMax: 0.56,
            corneringLimit: 20,
            stability: 3.8,
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
            engineForce: 15500,
            brakeForce: 12000,
            maxSpeed: 33,
            maxRpm: 5400,
            gears: [2.6, 1.5, 1.0],
            /* The whole personality: almost no lateral bite, so it slides
               everywhere on land, and it lets go smoothly rather than
               snapping. On water none of that matters. */
            grip: 0.95,
            peakSlipAngle: 0.42,
            peakSlipRatio: 0.3,
            loadSensitivity: 0.05,
            steerMax: 0.72,
            steerSpeed: 4.4,
            corneringLimit: 11,
            stability: 0.9,
            counterSteer: 0.62,
            rollingResistance: 22,
            suspensionRest: 0.55,
            suspensionTravel: 0.4,
            suspensionStiffness: 30000,
            suspensionDamping: 2600,
            antiRoll: 4000,
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
            engineForce: 25000,
            maxSpeed: 25,
            maxRpm: 3800,
            gears: [3.8, 2.1, 1.35, 1.0],
            grip: 1.9,
            peakSlipAngle: 0.23,
            peakSlipRatio: 0.22,
            loadSensitivity: 0.12,
            steerMax: 0.66,
            steerSpeed: 3.8,
            corneringLimit: 19,
            stability: 5.2,
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
 *
 * Paint is a physical material with a clearcoat over it, so the body picks up
 * the sky as a second, sharper reflection on top of the colour. That one
 * property is most of the difference between "a coloured shape" and "a
 * lacquered toy" — it is what the eye reads as expensive.
 * --------------------------------------------------------------- */

const materialCache = new Map();

function mat(color, opts = {}) {
    const key = `${color}|${JSON.stringify(opts)}`;
    let m = materialCache.get(key);
    if (m) return m;

    const common = {
        color,
        roughness: opts.roughness ?? 0.34,
        metalness: opts.metalness ?? 0.12,
        emissive: opts.emissive ?? 0x000000,
        emissiveIntensity: opts.emissiveIntensity ?? 1,
        transparent: opts.transparent ?? false,
        opacity: opts.opacity ?? 1,
        side: opts.side ?? THREE.FrontSide,
        flatShading: opts.flatShading ?? false,
        envMapIntensity: opts.envMapIntensity ?? 1,
    };

    m = opts.clearcoat
        ? new THREE.MeshPhysicalMaterial({
              ...common,
              clearcoat: opts.clearcoat,
              clearcoatRoughness: opts.clearcoatRoughness ?? 0.06,
          })
        : new THREE.MeshStandardMaterial(common);

    materialCache.set(key, m);
    return m;
}

/* Bodywork: colour under a lacquer coat. */
/* A full-strength clearcoat sits a mirror over the colour and takes a
   surprising amount of it away — the police cruiser came out navy. Two
   thirds keeps the wet-lacquer highlight and lets the blue back through. */
const PAINT = { roughness: 0.32, metalness: 0.0, clearcoat: 0.65, clearcoatRoughness: 0.05, envMapIntensity: 1.2 };
const TRIM = { roughness: 0.5, metalness: 0.05, envMapIntensity: 0.9 };
const CHROME = { roughness: 0.13, metalness: 1, envMapIntensity: 1.6 };
const RUBBER = { roughness: 0.92, metalness: 0.0, envMapIntensity: 0.35 };
const GLASS = {
    roughness: 0.03,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    transparent: true,
    opacity: 0.42,
    envMapIntensity: 2.2,
};

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

/* A lamp that can be switched on. Kept as one helper so headlights, brake
   lights, indicators and beacons all respond the same way and the game only
   has to set `.userData.on`. */
function lamp(radius, colour, emissive, intensity, segments = 12) {
    const m = sphere(radius, colour, { emissive, emissiveIntensity: intensity, roughness: 0.08, metalness: 0 }, segments);
    /* Its own material instance: these are driven per-vehicle at runtime and
       must not be shared with anything else through the cache. */
    m.material = m.material.clone();
    m.userData.baseIntensity = intensity;
    return m;
}

/* A wheel: fat rounded tyre, dished rim, chrome hub, and a brake disc you can
   see through the spokes. */
function buildWheel(radius, width, rimColor) {
    const group = new THREE.Group();

    const tyre = mesh(tyreGeometry(radius, width), 0x1c1c22, RUBBER);
    group.add(tyre);

    /* One groove around the shoulder rather than a ring of tread blocks. The
       blocks were correct and unreadable: at any distance the game actually
       shows a wheel from, they alias into a black scribble. */
    const groove = mesh(new THREE.TorusGeometry(radius * 0.99, width * 0.1, 6, 24), 0x0e0e12, RUBBER);
    groove.rotation.y = Math.PI / 2;
    group.add(groove);

    const disc = cyl(radius * 0.58, radius * 0.58, width * 0.28, 0x767b82, 16, {
        roughness: 0.42,
        metalness: 0.5,
        envMapIntensity: 0.7,
    });
    disc.rotation.z = Math.PI / 2;
    group.add(disc);

    /* A dished rim with five spokes and a hubcap. The hub is the only part of
       a wheel that is still legible when it is spinning, so it carries the
       colour. */
    const rim = cyl(radius * 0.66, radius * 0.66, width * 0.9, rimColor, 20, {
        roughness: 0.28,
        metalness: 0.18,
        envMapIntensity: 0.65,
    });
    rim.rotation.z = Math.PI / 2;
    group.add(rim);

    const lip = mesh(new THREE.TorusGeometry(radius * 0.68, radius * 0.06, 8, 22), 0xdfe6ee, CHROME);
    lip.rotation.y = Math.PI / 2;
    group.add(lip);

    for (let i = 0; i < 5; i += 1) {
        const spoke = mesh(roundedBox(width * 0.72, radius * 0.92, radius * 0.16, radius * 0.06, 2), rimColor, {
            roughness: 0.26,
            metalness: 0.18,
            envMapIntensity: 0.65,
        });
        spoke.rotation.x = (i / 5) * Math.PI;
        group.add(spoke);
    }

    const cap = cyl(radius * 0.26, radius * 0.3, width * 1.04, 0xf2f5f8, 14, CHROME);
    cap.rotation.z = Math.PI / 2;
    group.add(cap);

    const nut = cyl(radius * 0.09, radius * 0.09, width * 1.1, 0x9aa1a8, 10, CHROME);
    nut.rotation.z = Math.PI / 2;
    group.add(nut);

    return group;
}

/* The pup at the wheel.
 *
 * The head is the same one the character on foot wears, built in pups.js, so
 * the face through the windscreen and the face beside the truck are the same
 * face. Getting out used to be a downgrade.
 */
function buildDriver(pup) {
    const group = new THREE.Group();

    const head = buildPupHead(pup);
    head.position.y = 0.2;
    group.add(head);

    /* Shoulders and paws on the wheel, so there is a body under the head
       rather than a head balanced on a seat. */
    const shoulders = mesh(roundedBox(0.62, 0.3, 0.4, 0.14, 3), pup.colour, PAINT);
    shoulders.position.set(0, -0.16, -0.04);
    group.add(shoulders);

    for (const side of [-1, 1]) {
        const paw = mesh(roundedBox(0.15, 0.12, 0.2, 0.05, 2), pup.trim, TRIM);
        paw.position.set(side * 0.19, -0.14, 0.28);
        group.add(paw);
    }

    return group;
}

/* A number plate. Text drawn into a canvas, which is the only way to get
   letters onto a mesh without shipping a font atlas — and a truck without a
   plate is a shape, while a truck with one is a vehicle somebody owns. */
const plateCache = new Map();
function plateTexture(text) {
    if (plateCache.has(text)) return plateCache.get(text);
    const el = document.createElement("canvas");
    el.width = 256;
    el.height = 80;
    const ctx = el.getContext("2d");
    ctx.fillStyle = "#f4f5f0";
    ctx.fillRect(0, 0, 256, 80);
    ctx.strokeStyle = "#2b3138";
    ctx.lineWidth = 5;
    ctx.strokeRect(6, 6, 244, 68);
    ctx.fillStyle = "#20262d";
    ctx.font = "bold 46px 'Baloo 2', 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.toUpperCase().slice(0, 8), 128, 44);
    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    plateCache.set(text, tex);
    return tex;
}

/*
 * A headlight worth the name.
 *
 * A glowing sphere stuck on the nose reads as a sticker. A real lamp is a
 * bright thing sitting *inside* a dark housing behind a clear cover, and the
 * three-layer version below costs three meshes and completely changes how
 * expensive the front of the vehicle looks — because it is the one place the
 * eye goes first, and the one place a highlight can catch.
 */
function buildLampCluster(radius, colour, emissive, intensity, depth = 0.9) {
    const cluster = new THREE.Group();

    const housing = cyl(radius * 1.16, radius * 1.05, radius * depth, 0x24282e, 16, {
        roughness: 0.5,
        metalness: 0.2,
    });
    housing.rotation.x = Math.PI / 2;
    cluster.add(housing);

    const reflector = cyl(radius * 1.02, radius * 0.4, radius * depth * 0.8, 0xf2f6fb, 16, CHROME);
    reflector.rotation.x = Math.PI / 2;
    reflector.position.z = -radius * 0.1;
    cluster.add(reflector);

    const bulb = lamp(radius * 0.62, colour, emissive, intensity, 12);
    bulb.position.z = radius * 0.1;
    cluster.add(bulb);

    /* The clear cover, slightly domed. Its specular is what sells the glass. */
    const cover = mesh(
        new THREE.SphereGeometry(radius * 1.08, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
        0xdff2ff,
        { ...GLASS, opacity: 0.28 }
    );
    cover.rotation.x = Math.PI / 2;
    cover.position.z = radius * 0.24;
    cover.castShadow = false;
    cluster.add(cover);

    cluster.userData.bulb = bulb;
    return cluster;
}

/* The light bar: chrome frame with two dome lamps that flash. */
function buildLightBar(pup, width) {
    const group = new THREE.Group();
    group.add(rbox(width, 0.12, 0.26, 0x2f333c, 0, 0, 0, CHROME, 0.05));

    const lamps = [];
    for (const side of [-1, 1]) {
        const colour = side < 0 ? 0xff2f22 : 0x2f6fe0;
        const dome = lamp(0.13, colour, colour, 0.25, 14);
        dome.scale.set(width * 0.24, 0.85, 1);
        dome.position.set(side * width * 0.26, 0.08, 0);
        group.add(dome);
        lamps.push(dome);
    }
    group.userData.lamps = lamps;
    return group;
}

/*
 * A truck.
 *
 * The first attempt was a slab the full width of the track with the wheels
 * tucked underneath it, and it read as a coloured brick. What makes these
 * vehicles read as *toys* is a specific proportion, and it is worth stating
 * because everything below follows from it:
 *
 *   the body is narrower than the track, so the wheels stand proud of the
 *   flanks and you can see all of them;
 *
 *   the wheels are enormous relative to the body, and the arches over them
 *   are thick enough to be part of the silhouette rather than a hoop;
 *
 *   the glass is a large fraction of the height, not a slit, and there is
 *   something behind it;
 *
 *   and every horizontal surface is either chrome or has a chrome edge, so
 *   the whole thing catches light from any angle.
 */
function buildCar(pup) {
    const group = new THREE.Group();
    const { size } = pup.spec;
    const h = size.y;
    const l = size.z;
    /* Bodywork is deliberately narrower than the track. */
    const track = Math.max(...pup.spec.wheels.map((wheel) => Math.abs(wheel.x)));
    const w = Math.min(size.x, track * 1.72);
    const half = w * 0.5;

    /* ---- lower body ----
       One deep tub, plus a slightly narrower nose section so the front is not
       the same rectangle as the middle. */
    const body = rbox(w, h * 0.66, l * 0.98, pup.colour, 0, -h * 0.04, 0, PAINT, Math.min(w, h) * 0.3);
    group.add(body);

    const nose = rbox(w * 0.94, h * 0.5, l * 0.3, pup.colour, 0, -h * 0.06, l * 0.34, PAINT, h * 0.2);
    group.add(nose);

    /* Bonnet: a raised panel with a chrome lip, so the top of the nose is not
       one flat plane running into the windscreen. */
    const bonnet = rbox(w * 0.78, h * 0.1, l * 0.26, pup.colour, 0, h * 0.2, l * 0.3, PAINT, 0.05);
    group.add(bonnet);
    group.add(rbox(w * 0.8, 0.035, 0.05, 0xdfe6ee, 0, h * 0.25, l * 0.43, CHROME, 0.015));

    /* ---- greenhouse ----
       Dark pillars first, then the glass over them. Doing it the other way
       round gives a bubble with nothing holding it up. */
    const pillars = rbox(w * 0.76, h * 0.5, l * 0.44, pup.trim, 0, h * 0.4, -l * 0.05, TRIM, h * 0.16);
    group.add(pillars);

    const roof = rbox(w * 0.7, h * 0.1, l * 0.4, pup.colour, 0, h * 0.62, -l * 0.05, PAINT, h * 0.05);
    group.add(roof);

    const glass = mesh(canopyGeometry(w * 0.86, h * 0.86, l * 0.54), 0x1b334a, GLASS);
    glass.castShadow = false;
    glass.position.set(0, h * 0.3, -l * 0.02);
    group.add(glass);

    /* ---- interior ----
       Only ever glimpsed, and its absence is exactly why a tinted canopy looks
       like a tinted bubble. */
    const cabin = rbox(w * 0.66, 0.06, l * 0.36, 0x232a33, 0, h * 0.19, -l * 0.04, TRIM, 0.02);
    cabin.castShadow = false;
    group.add(cabin);
    const seat = rbox(w * 0.46, h * 0.34, 0.12, pup.trim, 0, h * 0.4, -l * 0.2, TRIM, 0.05);
    seat.castShadow = false;
    group.add(seat);
    const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(h * 0.13, h * 0.025, 8, 16), mat(0x1d2229, TRIM));
    wheelRim.rotation.x = 1.15;
    wheelRim.position.set(0, h * 0.36, l * 0.12);
    wheelRim.castShadow = false;
    group.add(wheelRim);

    /* ---- belt line ----
       The accent band. Slightly proud of the body so it casts its own thin
       shadow, which is what makes it read as a decal on a surface rather than
       as a change of colour. */
    const stripe = rbox(w * 1.02, h * 0.14, l * 0.8, pup.accent, 0, h * 0.04, -l * 0.02, PAINT, 0.05);
    group.add(stripe);

    /* ---- arches ----
       Thick, elliptical, sitting flush with the flank, each with a dark liner
       behind it so there is a shadowed recess for the wheel to sit in. */
    const seenSides = new Set();
    pup.spec.wheels.forEach((wheel) => {
        const side = Math.sign(wheel.x);
        const key = `${side}|${wheel.z.toFixed(2)}`;
        if (seenSides.has(key)) return;
        seenSides.add(key);

        const r = wheel.radius;
        /* Sit the arch where the wheel *rests*, not where it is bolted: the
           springs carry the body about three quarters of the suspension travel
           above the hub, and an arch drawn at the mounting point floats a third
           of a metre above the tyre it is supposed to cover. */
        const hub = wheel.y - pup.spec.suspensionRest * 0.72;

        const arch = mesh(new THREE.TorusGeometry(r * 1.2, r * 0.26, 8, 20, Math.PI), pup.colour, PAINT);
        arch.rotation.y = Math.PI / 2;
        arch.scale.set(1.08, 0.96, 1);
        arch.position.set(side * (half - r * 0.06), hub, wheel.z);
        group.add(arch);

        const liner = mesh(new THREE.TorusGeometry(r * 1.06, r * 0.32, 6, 14, Math.PI), 0x191d22, {
            roughness: 0.9,
            metalness: 0,
            envMapIntensity: 0.2,
        });
        liner.rotation.y = Math.PI / 2;
        liner.position.set(side * (half - r * 0.36), hub, wheel.z);
        liner.castShadow = false;
        group.add(liner);
    });

    /* ---- sills, bumpers, grille ---- */
    for (const side of [-1, 1]) {
        group.add(rbox(0.14, 0.11, l * 0.42, pup.trim, side * (half - 0.02), -h * 0.3, 0, TRIM, 0.045));
    }

    group.add(mesh(barGeometry(w * 1.04, h * 0.19, 0.28), 0xdfe6ee, CHROME).translateY(-h * 0.24).translateZ(l * 0.47));
    group.add(mesh(barGeometry(w * 1.04, h * 0.19, 0.28), 0xdfe6ee, CHROME).translateY(-h * 0.24).translateZ(-l * 0.47));

    const grille = rbox(w * 0.56, h * 0.19, 0.1, 0x22262c, 0, h * 0.0, l * 0.49, TRIM, 0.03);
    group.add(grille);
    for (let i = -1; i <= 1; i += 1) {
        const slat = rbox(w * 0.54, 0.025, 0.06, 0xcfd7df, 0, h * 0.0 + i * h * 0.06, l * 0.515, CHROME, 0.01);
        slat.castShadow = false;
        group.add(slat);
    }

    /* ---- door badge ----
       A recessed disc with the paw proud of it, rather than a paw floating on
       the paintwork. */
    for (const side of [-1, 1]) {
        const disc = cyl(0.34, 0.34, 0.03, pup.accent, 22, PAINT);
        disc.rotation.z = Math.PI / 2;
        disc.position.set(side * (half + 0.012), h * 0.04, -l * 0.04);
        disc.castShadow = false;
        group.add(disc);

        const badge = mesh(pawGeometry(0.44, 0.045), pup.trim, { roughness: 0.35, metalness: 0.1 });
        badge.position.set(side * (half + 0.035), h * 0.04, -l * 0.04);
        badge.rotation.y = side * Math.PI * 0.5;
        badge.castShadow = false;
        group.add(badge);
    }

    /* ---- lights ----
       Headlights, brake lights and reversing lights are all driven at runtime,
       so the back of the truck tells you what the driver is doing — which is
       most of what makes anything in front of you legible in a driving game. */
    const headlights = [];
    const brakeLights = [];
    const reverseLights = [];
    for (const side of [-1, 1]) {
        const head = buildLampCluster(h * 0.15, 0xfff8e0, 0xfff0c0, 0.45);
        head.position.set(side * w * 0.34, h * 0.02, l * 0.48);
        group.add(head);
        headlights.push(head.userData.bulb);

        /* An indicator beside each headlight, so the front is a cluster rather
           than a single eye — the difference between a face and a cyclops. */
        const indicator = lamp(h * 0.055, 0xffa53d, 0xff8a1a, 0.25, 10);
        indicator.scale.set(1.5, 0.8, 0.5);
        indicator.position.set(side * w * 0.48, -h * 0.06, l * 0.46);
        group.add(indicator);

        const tail = buildLampCluster(h * 0.12, 0xe0281b, 0xff2a1a, 0.35, 0.7);
        tail.rotation.y = Math.PI;
        tail.position.set(side * w * 0.36, h * 0.06, -l * 0.48);
        group.add(tail);
        brakeLights.push(tail.userData.bulb);

        const reverse = lamp(h * 0.06, 0xf4f8ff, 0xffffff, 0.05, 10);
        reverse.scale.set(1.3, 0.9, 0.5);
        reverse.position.set(side * w * 0.16, -h * 0.06, -l * 0.49);
        group.add(reverse);
        reverseLights.push(reverse);
    }

    /* ---- mirrors ---- */
    for (const side of [-1, 1]) {
        group.add(rbox(0.14, 0.045, 0.045, 0x3a3f47, side * (half + 0.06), h * 0.34, l * 0.2, TRIM, 0.02));
        const glass2 = rbox(0.055, 0.15, 0.12, 0xdfe6ee, side * (half + 0.15), h * 0.36, l * 0.2, CHROME, 0.025);
        group.add(glass2);
    }

    /* ---- plates ---- */
    const plate = plateTexture(pup.name);
    for (const end of [-1, 1]) {
        const board = new THREE.Mesh(
            new THREE.BoxGeometry(0.56, 0.18, 0.03),
            new THREE.MeshStandardMaterial({ map: plate, roughness: 0.55, metalness: 0.05 })
        );
        board.position.set(0, -h * 0.34, end * (l * 0.5));
        board.rotation.y = end > 0 ? 0 : Math.PI;
        board.castShadow = false;
        group.add(board);
    }

    /* ---- exhaust ---- */
    const exhaust = cyl(0.07, 0.08, 0.22, 0xc8ced6, 10, CHROME);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(w * 0.3, -h * 0.34, -l * 0.52);
    group.add(exhaust);

    const driver = buildDriver(pup);
    driver.position.set(0, h * 0.42, l * 0.04);
    driver.scale.setScalar(0.88);
    group.add(driver);

    const lightBar = buildLightBar(pup, w * 0.66);
    lightBar.position.set(0, h * 0.7, -l * 0.05);
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

        const tank = cyl(0.44, 0.44, l * 0.42, 0xf4f6f8, 18, { roughness: 0.22, metalness: 0.6 });
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
        const beacon = lamp(0.17, 0xffb114, 0xff9500, 0.8);
        beacon.position.set(0, h * 0.92, -l * 0.06);
        extras.add(beacon);
        group.userData.beacon = beacon;
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
    group.userData.brakeLights = brakeLights;
    group.userData.reverseLights = reverseLights;
    group.userData.driver = driver;
    /* Where the exhaust smoke comes from, and where a tow rope would attach. */
    group.userData.exhaust = new THREE.Vector3(w * 0.3, -h * 0.22, -l * 0.5);
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
    const glass = mesh(canopyGeometry(1.9, 1.5, 2.5, Math.PI * 1.5), 0x16283a, GLASS);
    glass.castShadow = false;
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
        const blade = rbox(0.36, 0.06, 8.0, 0x2f343a, 0, 0.06, 0, { roughness: 0.5, metalness: 0.2 }, 0.03);
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

    /* The blur disc: at speed a rotor is a translucent circle, not four
       blades, and switching to it is what stops the strobing. */
    const disc = new THREE.Mesh(
        new THREE.CircleGeometry(7.9, 40),
        new THREE.MeshBasicMaterial({
            color: 0xdfe6ee,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
        })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(0, 1.36, 0.3);
    group.add(disc);
    group.userData.rotorDisc = disc;

    const mast = cyl(0.14, 0.17, 0.62, 0x9aa1a8, 10, CHROME);
    mast.position.set(0, 1.0, 0.3);
    group.add(mast);

    const tailRotor = new THREE.Group();
    for (let i = 0; i < 3; i += 1) {
        const blade = rbox(0.07, 1.5, 0.16, 0x2f343a, 0, 0, 0, { roughness: 0.5, metalness: 0.2 }, 0.03);
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
    const badge = mesh(pawGeometry(0.7, 0.06), 0xffffff, { roughness: 0.3, metalness: 0.05 });
    badge.position.set(0.23, 0.3, -size.z * 0.44);
    badge.rotation.y = Math.PI * 0.5;
    group.add(badge);

    const driver = buildDriver(pup);
    driver.position.set(0, 0.14, 1.0);
    driver.scale.setScalar(0.88);
    group.add(driver);

    const beacon = lamp(0.14, 0xff3b30, 0xff2a1a, 0.9, 10);
    beacon.position.set(0, -0.98, 0.3);
    group.add(beacon);

    const searchlight = lamp(0.16, 0xfff6d8, 0xfff0c0, 0.2, 10);
    searchlight.position.set(0, -0.7, 1.7);
    group.add(searchlight);

    group.userData.rotor = rotor;
    group.userData.tailRotor = tailRotor;
    group.userData.wheels = [];
    group.userData.beacon = beacon;
    group.userData.headlights = [searchlight];
    group.userData.brakeLights = [];
    group.userData.reverseLights = [];
    group.userData.driver = driver;
    return group;
}

export function buildVehicleMesh(pup) {
    const mesh2 = pup.spec.kind === "heli" ? buildHelicopter(pup) : buildCar(pup);
    mesh2.name = `vehicle-${pup.id}`;
    return mesh2;
}

export { mat as vehicleMaterial, rbox as vehicleBox, cyl as vehicleCylinder, sphere as vehicleSphere, PAINT, CHROME };

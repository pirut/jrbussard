/*
 * The mission director.
 *
 * Missions are generated, not authored. A template picks its own locations
 * from the road network and the terrain, decides how many of a thing there
 * are, how long you get, which pup is needed and what it is all called — so
 * the same template produces "Get six crates from the Quarry to the Harbour in
 * ninety seconds" one time and "Four crates, Farm to Lookout, no clock" the
 * next.
 *
 * Underneath, every mission is the same shape: an ordered list of objectives,
 * each of which is a place you must be and a thing you must do there. That is
 * what lets nine templates share one update loop, one marker renderer and one
 * HUD.
 */

import * as THREE from "three";
import { PLACES, placeById, randomRoadPoint, randomLandPoint, heightAt } from "./world";
import { makeRandom } from "./noise";

/* ---------------------------------------------------------------- *
 * Flavour
 * ---------------------------------------------------------------- */

const CRITTERS = [
    "Cali the cat",
    "Chickaletta",
    "a very slow turtle",
    "three escaped piglets",
    "Mayor Goodway's parrot",
    "a lost puppy",
    "Farmer Al's runaway goat",
    "a kitten up past its bedtime",
];

const CARGO = [
    "crates of dog treats",
    "boxes of spare wheels",
    "bales of hay",
    "sacks of birdseed",
    "buckets of paint",
    "crates of pizza",
    "toolboxes",
    "parcels for the harbour",
];

const LOST_THINGS = [
    "paw badges",
    "lost beach balls",
    "runaway kites",
    "Rubble's missing bones",
    "recycling bins",
    "party balloons",
];

const URGENCY = ["Quick,", "Right away —", "No time to lose:", "Paw Patrol,", "Emergency!"];

function pick(random, list) {
    return list[Math.floor(random() * list.length)];
}

function pickPlace(random, filter) {
    const options = PLACES.filter(filter || (() => true));
    return options[Math.floor(random() * options.length)] || PLACES[0];
}

/* ---------------------------------------------------------------- *
 * Markers
 *
 * Every objective gets a beam of light and a ring on the ground. It is not
 * subtle, and it should not be: the point of an open world is that you can go
 * anywhere, which is exactly why you need to be told where to go.
 * ---------------------------------------------------------------- */

const ringGeometry = new THREE.RingGeometry(2.6, 3.6, 28);
ringGeometry.rotateX(-Math.PI / 2);
const beamGeometry = new THREE.CylinderGeometry(1.5, 2.4, 60, 14, 1, true);
beamGeometry.translate(0, 30, 0);

function makeMarker(colour) {
    const group = new THREE.Group();

    const ring = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85, depthWrite: false })
    );
    ring.position.y = 0.16;
    group.add(ring);

    const beam = new THREE.Mesh(
        beamGeometry,
        new THREE.MeshBasicMaterial({
            color: colour,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            side: THREE.DoubleSide,
        })
    );
    group.add(beam);

    const bead = new THREE.Mesh(
        new THREE.OctahedronGeometry(1.15, 0),
        new THREE.MeshBasicMaterial({ color: colour })
    );
    bead.position.y = 3.4;
    group.add(bead);

    group.userData.ring = ring;
    group.userData.bead = bead;
    group.userData.beam = beam;
    group.renderOrder = 3;
    return group;
}

/* A thing you collect: a spinning box or a bobbing critter. */
function makePickup(kind, colour) {
    const group = new THREE.Group();
    if (kind === "crate") {
        const crate = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 1.6, 1.6),
            new THREE.MeshLambertMaterial({ color: 0xc08a44 })
        );
        crate.castShadow = true;
        group.add(crate);
        for (const axis of ["x", "y"]) {
            const strap = new THREE.Mesh(
                new THREE.BoxGeometry(axis === "x" ? 1.7 : 0.24, axis === "x" ? 0.24 : 1.7, 1.7),
                new THREE.MeshLambertMaterial({ color: 0x8a5a28 })
            );
            group.add(strap);
        }
    } else if (kind === "badge") {
        const badge = new THREE.Mesh(
            new THREE.CylinderGeometry(1.1, 1.1, 0.24, 18),
            new THREE.MeshLambertMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.35 })
        );
        badge.rotation.x = Math.PI / 2;
        badge.castShadow = true;
        group.add(badge);
    } else {
        /* A critter: body, head, ears, tail. Small, but it reads. */
        const body = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.42, 0.5, 6, 10),
            new THREE.MeshLambertMaterial({ color: colour })
        );
        body.rotation.z = Math.PI / 2;
        body.position.y = 0.55;
        body.castShadow = true;
        group.add(body);
        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.34, 12, 10),
            new THREE.MeshLambertMaterial({ color: colour })
        );
        head.position.set(0, 0.86, 0.5);
        group.add(head);
        for (const side of [-1, 1]) {
            const ear = new THREE.Mesh(
                new THREE.ConeGeometry(0.13, 0.26, 6),
                new THREE.MeshLambertMaterial({ color: colour })
            );
            ear.position.set(side * 0.16, 1.14, 0.46);
            group.add(ear);
            const eye = new THREE.Mesh(
                new THREE.SphereGeometry(0.06, 8, 6),
                new THREE.MeshLambertMaterial({ color: 0x1a1a1f })
            );
            eye.position.set(side * 0.13, 0.92, 0.76);
            group.add(eye);
        }
        const tail = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.1, 0.5, 4, 6),
            new THREE.MeshLambertMaterial({ color: colour })
        );
        tail.position.set(0, 0.86, -0.55);
        tail.rotation.x = -0.7;
        group.add(tail);
    }
    return group;
}

function makeFire() {
    const group = new THREE.Group();
    const flames = [];
    for (let i = 0; i < 5; i += 1) {
        const flame = new THREE.Mesh(
            new THREE.ConeGeometry(0.7 - i * 0.07, 2.2 - i * 0.16, 7),
            new THREE.MeshBasicMaterial({
                color: i < 2 ? 0xfff07a : i < 4 ? 0xff8a1f : 0xe83c14,
                transparent: true,
                opacity: 0.85,
            })
        );
        flame.position.set((Math.random() - 0.5) * 1.4, 1.0 + Math.random() * 0.5, (Math.random() - 0.5) * 1.4);
        group.add(flame);
        flames.push(flame);
    }
    const light = new THREE.PointLight(0xff7a2a, 90, 30, 2);
    light.position.y = 2;
    group.add(light);

    const scorch = new THREE.Mesh(
        new THREE.CircleGeometry(2.4, 18),
        new THREE.MeshBasicMaterial({ color: 0x2a1a12, transparent: true, opacity: 0.6, depthWrite: false })
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = 0.08;
    group.add(scorch);

    group.userData.flames = flames;
    group.userData.light = light;
    return group;
}

/* ---------------------------------------------------------------- *
 * Templates
 *
 * Each returns a mission descriptor. `random` is seeded per mission so a
 * given offer is stable while it sits on the board.
 * ---------------------------------------------------------------- */

const TEMPLATES = [
    /* ---- fetch a stranded animal and bring it home ---- */
    function rescue(random, level) {
        const critter = pick(random, CRITTERS);
        const from = pickPlace(random, (p) => p.kind !== "hq");
        const spot = randomLandPoint(random, { near: from, radius: 80, maxSlope: 0.4 });
        const home = pickPlace(random, (p) => p.kind === "hq" || p.kind === "town");

        return {
            kind: "rescue",
            title: `Rescue ${critter}`,
            brief: `${pick(random, URGENCY)} ${critter} is stuck out near ${from.name}. Bring them back to ${home.name}.`,
            colour: 0x4fd6c8,
            reward: 120 + level * 20,
            objectives: [
                {
                    kind: "collect",
                    label: `Reach ${critter}`,
                    x: spot.x,
                    z: spot.z,
                    radius: 7,
                    pickup: "critter",
                    pickupColour: [0xe8c48a, 0xf5f0e6, 0xd8a24a, 0x9a7b5f][Math.floor(random() * 4)],
                },
                {
                    kind: "reach",
                    label: `Take them to ${home.name}`,
                    x: home.x,
                    z: home.z,
                    radius: 12,
                    carrying: true,
                },
            ],
        };
    },

    /* ---- put a fire out; Marshall only ---- */
    function fire(random, level) {
        const where = pickPlace(random, (p) => p.kind !== "hq");
        const count = 3 + Math.floor(random() * (2 + level));
        const objectives = [];
        for (let i = 0; i < count; i += 1) {
            const spot = randomLandPoint(random, { near: where, radius: 46, maxSlope: 0.45, offRoad: false });
            objectives.push({
                kind: "extinguish",
                label: `Put out fire ${i + 1} of ${count}`,
                x: spot.x,
                z: spot.z,
                radius: 13,
                fuel: 2.4 + random() * 1.6,
                anyOrder: true,
            });
        }
        return {
            kind: "fire",
            title: `Fire at ${where.name}`,
            brief: `${pick(random, URGENCY)} there are ${count} fires burning near ${where.name}. Only Marshall has water.`,
            colour: 0xff5c3a,
            requiredPup: "marshall",
            reward: 180 + level * 30,
            timeLimit: 95 + count * 22,
            objectives,
        };
    },

    /* ---- pick up cargo, drop it off, against the clock ---- */
    function delivery(random, level) {
        const cargo = pick(random, CARGO);
        const from = pickPlace(random, () => true);
        let to = pickPlace(random, (p) => p.id !== from.id);
        if (to.id === from.id) to = placeById("lookout");
        const count = 2 + Math.floor(random() * (2 + level * 0.5));
        const objectives = [];

        for (let i = 0; i < count; i += 1) {
            const spot = randomLandPoint(random, { near: from, radius: 40, maxSlope: 0.4, offRoad: false });
            objectives.push({
                kind: "collect",
                label: `Load ${cargo} (${i + 1}/${count})`,
                x: spot.x,
                z: spot.z,
                radius: 7,
                pickup: "crate",
                anyOrder: true,
            });
        }
        objectives.push({
            kind: "reach",
            label: `Unload at ${to.name}`,
            x: to.x,
            z: to.z,
            radius: 13,
        });

        const distance = Math.hypot(to.x - from.x, to.z - from.z);
        return {
            kind: "delivery",
            title: `${cargo[0].toUpperCase()}${cargo.slice(1)} to ${to.name}`,
            brief: `Collect ${count} lots of ${cargo} around ${from.name} and get them to ${to.name}.`,
            colour: 0xffc93c,
            reward: 100 + count * 30 + level * 15,
            timeLimit: Math.round(70 + distance * 0.55 + count * 26),
            objectives,
        };
    },

    /* ---- scattered collectibles on a timer ---- */
    function scavenge(random, level) {
        const thing = pick(random, LOST_THINGS);
        const where = pickPlace(random, () => true);
        const count = 4 + Math.floor(random() * (3 + level));
        const objectives = [];
        for (let i = 0; i < count; i += 1) {
            const spot = randomLandPoint(random, { near: where, radius: 105, maxSlope: 0.5, offRoad: false });
            objectives.push({
                kind: "collect",
                label: `${thing} (${i + 1}/${count})`,
                x: spot.x,
                z: spot.z,
                radius: 6.5,
                pickup: "badge",
                pickupColour: 0xffd23f,
                anyOrder: true,
            });
        }
        return {
            kind: "scavenge",
            title: `${count} ${thing} near ${where.name}`,
            brief: `The wind has scattered ${thing} all over ${where.name}. Round them all up.`,
            colour: 0xffd23f,
            reward: 90 + count * 22 + level * 10,
            timeLimit: 60 + count * 24,
            objectives,
        };
    },

    /* ---- a checkpoint run along the roads ---- */
    function race(random, level) {
        const count = 5 + Math.floor(random() * (3 + level));
        const objectives = [];
        let previous = randomRoadPoint(random);
        for (let i = 0; i < count; i += 1) {
            /* Pick road points that keep moving away from the last one, so the
               route goes somewhere instead of doubling back on itself. */
            let best = null;
            for (let attempt = 0; attempt < 14; attempt += 1) {
                const candidate = randomRoadPoint(random);
                const d = Math.hypot(candidate.x - previous.x, candidate.z - previous.z);
                if (d < 70 || d > 260) continue;
                if (!best) best = candidate;
            }
            const point = best || randomRoadPoint(random);
            objectives.push({
                kind: "reach",
                label: `Checkpoint ${i + 1} of ${count}`,
                x: point.x,
                z: point.z,
                radius: 11,
            });
            previous = point;
        }
        return {
            kind: "race",
            title: `Time trial: ${count} checkpoints`,
            brief: "Ryder has set up a run across the island. Hit every checkpoint before the clock runs out.",
            colour: 0x9b6cff,
            reward: 140 + count * 24 + level * 20,
            timeLimit: Math.round(28 + count * 17 - level * 2),
            objectives,
        };
    },

    /* ---- something adrift in the bay; needs a pup who can swim ---- */
    function seaRescue(random, level) {
        const critter = pick(random, CRITTERS);
        /* Walk out from the beach until the ground is properly under water. */
        const beach = placeById("beach");
        const bearing = Math.atan2(beach.z, beach.x) + (random() - 0.5) * 0.8;
        let radius = Math.hypot(beach.x, beach.z) + 30;
        for (let i = 0; i < 30; i += 1) {
            const x = Math.cos(bearing) * radius;
            const z = Math.sin(bearing) * radius;
            if (heightAt(x, z) < -3) break;
            radius += 8;
        }
        const x = Math.cos(bearing) * radius;
        const z = Math.sin(bearing) * radius;
        const home = placeById("harbour");

        return {
            kind: "sea",
            title: `${critter} adrift`,
            brief: `${critter} has floated out past the beach. Zuma's hovercraft can get out there; so can Skye.`,
            colour: 0x4aa8ff,
            requiredAnyPup: ["zuma", "skye"],
            reward: 190 + level * 25,
            objectives: [
                {
                    kind: "collect",
                    label: `Reach ${critter}`,
                    x,
                    z,
                    radius: 9,
                    pickup: "critter",
                    pickupColour: 0xf5f0e6,
                    float: true,
                },
                { kind: "reach", label: `Back to ${home.name}`, x: home.x, z: home.z, radius: 13, carrying: true },
            ],
        };
    },

    /* ---- a rockslide across a road; needs the bulldozer ---- */
    function rockslide(random, level) {
        const point = randomRoadPoint(random, 120);
        const count = 3 + Math.floor(random() * (2 + level));
        const objectives = [];
        for (let i = 0; i < count; i += 1) {
            const angle = random() * Math.PI * 2;
            const spread = 6 + random() * 14;
            objectives.push({
                kind: "shove",
                label: `Clear boulder ${i + 1} of ${count}`,
                x: point.x + Math.cos(angle) * spread,
                z: point.z + Math.sin(angle) * spread,
                radius: 5,
                anyOrder: true,
            });
        }
        return {
            kind: "rockslide",
            title: "Rockslide on the road",
            brief: `Boulders have come down across the road. Rubble's blade will shift them; nothing else will.`,
            colour: 0xf6a11f,
            requiredPup: "rubble",
            reward: 160 + count * 25 + level * 15,
            objectives,
        };
    },

    /* ---- something stuck up the mountain; Everest's ground ---- */
    function mountain(random, level) {
        const summit = placeById("summit");
        const spot = randomLandPoint(random, { near: summit, radius: 120, maxSlope: 0.7, minHeight: 40 });
        const home = placeById("lodge");
        return {
            kind: "mountain",
            title: "Stranded on the mountain",
            brief: `A snowmobile has broken down high on the mountain. Everest is the only one with the grip to get up there.`,
            colour: 0x7fe4ff,
            requiredPup: "everest",
            reward: 210 + level * 30,
            timeLimit: 190,
            objectives: [
                {
                    kind: "collect",
                    label: "Reach the stranded driver",
                    x: spot.x,
                    z: spot.z,
                    radius: 9,
                    pickup: "critter",
                    pickupColour: 0xe8d9bd,
                },
                { kind: "reach", label: `Down to ${home.name}`, x: home.x, z: home.z, radius: 13, carrying: true },
            ],
        };
    },

    /* ---- an aerial survey; Skye only ---- */
    function skyPatrol(random, level) {
        const count = 3 + Math.floor(random() * (2 + level * 0.5));
        const objectives = [];
        for (let i = 0; i < count; i += 1) {
            const spot = randomLandPoint(random, { maxSlope: 1.5, minHeight: -20 });
            objectives.push({
                kind: "hover",
                label: `Survey point ${i + 1} of ${count}`,
                x: spot.x,
                z: spot.z,
                radius: 14,
                hold: 2.0,
                anyOrder: true,
            });
        }
        return {
            kind: "sky",
            title: `Aerial survey: ${count} spots`,
            brief: "Ryder needs eyes in the sky. Hover over each spot until the camera has what it needs.",
            colour: 0xff9ad5,
            requiredPup: "skye",
            reward: 150 + count * 30 + level * 15,
            timeLimit: 60 + count * 30,
            objectives,
        };
    },
];

/* ---------------------------------------------------------------- *
 * Director
 * ---------------------------------------------------------------- */

let missionSeed = 1;

export class MissionDirector {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.onEvent = options.onEvent || (() => {});
        this.group = new THREE.Group();
        this.group.name = "missions";
        scene.add(this.group);

        this.offers = [];
        this.active = null;
        this.level = 1;
        this.completed = 0;
        this.failed = 0;
        this.treats = 0;
        this.carrying = null;
        this.time = 0;
        this.lastMessage = null;

        this.refreshOffers();
    }

    /* ---- offers ---- */

    generate() {
        missionSeed = (missionSeed * 1103515245 + 12345) & 0x7fffffff;
        const random = makeRandom(missionSeed);
        const template = TEMPLATES[Math.floor(random() * TEMPLATES.length)];
        const mission = template(random, this.level);
        mission.id = `m${missionSeed.toString(36)}`;
        mission.objectives.forEach((objective, i) => {
            objective.id = `${mission.id}-${i}`;
            objective.done = false;
            objective.progress = 0;
            objective.y = heightAt(objective.x, objective.z);
        });
        return mission;
    }

    refreshOffers() {
        while (this.offers.length < 3) {
            const mission = this.generate();
            /* Do not offer the same kind twice on the board at once — the
               variety is the point. */
            if (this.offers.some((m) => m.kind === mission.kind)) {
                if (this.offers.length >= 2) break;
                continue;
            }
            this.offers.push(mission);
        }
    }

    reroll() {
        this.offers = [];
        this.refreshOffers();
    }

    /* ---- lifecycle ---- */

    accept(missionId) {
        const mission = this.offers.find((m) => m.id === missionId);
        if (!mission) return null;
        this.abandon(true);
        this.offers = this.offers.filter((m) => m.id !== missionId);
        this.active = mission;
        mission.elapsed = 0;
        mission.remaining = mission.timeLimit || 0;
        this.buildMarkers(mission);
        this.refreshOffers();
        this.emit("accepted", mission.title, mission.colour);
        return mission;
    }

    abandon(silent = false) {
        if (!this.active) return;
        this.clearMarkers();
        this.dropCarried();
        if (!silent) this.emit("abandoned", "Mission abandoned", 0x9aa3ab);
        this.active = null;
    }

    emit(type, text, colour) {
        this.lastMessage = { type, text, colour, at: this.time };
        this.onEvent({ type, text, colour });
    }

    /* ---- markers ---- */

    buildMarkers(mission) {
        mission.objectives.forEach((objective) => {
            const marker = makeMarker(mission.colour);
            marker.position.set(objective.x, objective.float ? 0 : objective.y, objective.z);
            marker.visible = false;
            this.group.add(marker);
            objective.marker = marker;

            if (objective.pickup) {
                const pickup = makePickup(objective.pickup, objective.pickupColour || mission.colour);
                pickup.position.set(objective.x, (objective.float ? 0 : objective.y) + 1.1, objective.z);
                this.group.add(pickup);
                objective.mesh = pickup;
            } else if (objective.kind === "extinguish") {
                const fire = makeFire();
                fire.position.set(objective.x, objective.y, objective.z);
                this.group.add(fire);
                objective.mesh = fire;
            } else if (objective.kind === "shove") {
                const boulder = new THREE.Mesh(
                    new THREE.IcosahedronGeometry(2.4, 0),
                    new THREE.MeshLambertMaterial({ color: 0x8b8378 })
                );
                boulder.castShadow = true;
                boulder.position.set(objective.x, objective.y + 1.6, objective.z);
                this.group.add(boulder);
                objective.mesh = boulder;
                objective.restX = objective.x;
                objective.restZ = objective.z;
            }
        });
        this.updateMarkerVisibility();
    }

    clearMarkers() {
        if (!this.active) return;
        this.active.objectives.forEach((objective) => {
            [objective.marker, objective.mesh].forEach((node) => {
                if (!node) return;
                this.group.remove(node);
                node.traverse((child) => {
                    if (child.geometry && child.geometry !== ringGeometry && child.geometry !== beamGeometry) {
                        child.geometry.dispose();
                    }
                    if (child.material) child.material.dispose();
                });
            });
            objective.marker = null;
            objective.mesh = null;
        });
    }

    /* Only the objectives you can act on right now are lit. Ordered missions
       show one at a time; "any order" groups show all of theirs at once. */
    updateMarkerVisibility() {
        if (!this.active) return;
        const objectives = this.active.objectives;
        let firstPending = -1;
        for (let i = 0; i < objectives.length; i += 1) {
            if (!objectives[i].done) {
                firstPending = i;
                break;
            }
        }
        objectives.forEach((objective, i) => {
            let live = false;
            if (!objective.done && firstPending >= 0) {
                live = i === firstPending || (objective.anyOrder && objectives[firstPending].anyOrder);
            }
            objective.live = live;
            if (objective.marker) objective.marker.visible = live;
            if (objective.mesh) objective.mesh.visible = !objective.done;
        });
    }

    activeObjectives() {
        if (!this.active) return [];
        return this.active.objectives.filter((o) => o.live);
    }

    /* ---- carrying ---- */

    pickUp(objective, vehicleMesh) {
        if (!objective.mesh) return;
        this.carrying = objective.mesh;
        objective.carriedMesh = objective.mesh;
        /* Ride on the roof so you can see you have them. */
        vehicleMesh.add(objective.mesh);
        objective.mesh.position.set(0, 1.5, -0.7);
        objective.mesh.scale.setScalar(0.85);
        objective.mesh.visible = true;
        objective.mesh = null;
    }

    dropCarried() {
        if (!this.carrying) return;
        if (this.carrying.parent) this.carrying.parent.remove(this.carrying);
        this.carrying.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        this.carrying = null;
    }

    /* ---- the loop ---- */

    update(dt, context) {
        this.time += dt;
        const mission = this.active;

        /* Markers bob and turn whether or not you are near them. */
        this.group.children.forEach((child) => {
            if (!child.userData.bead) return;
            child.userData.bead.rotation.y += dt * 1.6;
            child.userData.bead.position.y = 3.4 + Math.sin(this.time * 2.2) * 0.35;
            child.userData.ring.scale.setScalar(1 + Math.sin(this.time * 2.6) * 0.07);
        });

        if (!mission) return null;

        if (mission.timeLimit) {
            mission.remaining -= dt;
            if (mission.remaining <= 0) {
                this.emit("failed", `Out of time — ${mission.title}`, 0xff5c3a);
                this.failed += 1;
                this.abandon(true);
                return null;
            }
        }
        mission.elapsed += dt;

        const { vehicle, vehicleMesh, ability } = context;
        const px = vehicle.position.x;
        const pz = vehicle.position.z;

        let changed = false;

        for (const objective of mission.objectives) {
            if (objective.done || !objective.live) continue;

            const dx = px - objective.x;
            const dz = pz - objective.z;
            const distance = Math.hypot(dx, dz);
            objective.distance = distance;

            switch (objective.kind) {
                case "collect": {
                    if (distance < objective.radius && vehicle.position.y - objective.y < 12) {
                        objective.done = true;
                        changed = true;
                        if (objective.pickup === "critter") this.pickUp(objective, vehicleMesh);
                        else this.consume(objective);
                        this.emit("progress", objective.label, mission.colour);
                    }
                    break;
                }

                case "reach": {
                    if (distance < objective.radius) {
                        objective.done = true;
                        changed = true;
                        if (objective.carrying) this.dropCarried();
                        this.emit("progress", objective.label, mission.colour);
                    }
                    break;
                }

                case "extinguish": {
                    /* Only counts while Marshall is actually spraying it. */
                    if (distance < objective.radius && ability === "water") {
                        objective.progress += dt;
                        const fraction = Math.min(1, objective.progress / objective.fuel);
                        if (objective.mesh) {
                            objective.mesh.scale.setScalar(Math.max(0.05, 1 - fraction));
                            objective.mesh.userData.light.intensity = 90 * (1 - fraction);
                        }
                        if (objective.progress >= objective.fuel) {
                            objective.done = true;
                            changed = true;
                            this.consume(objective);
                            this.emit("progress", objective.label, mission.colour);
                        }
                    }
                    break;
                }

                case "hover": {
                    const altitude = vehicle.position.y - heightAt(px, pz);
                    if (distance < objective.radius && altitude > 8 && altitude < 90 && vehicle.speed < 16) {
                        objective.progress += dt;
                        if (objective.progress >= objective.hold) {
                            objective.done = true;
                            changed = true;
                            this.emit("progress", objective.label, mission.colour);
                        }
                    } else {
                        objective.progress = Math.max(0, objective.progress - dt * 0.6);
                    }
                    break;
                }

                case "shove": {
                    /* Push the boulder far enough off the road and it is dealt
                       with. Rubble shoves; everyone else bounces. */
                    if (objective.mesh) {
                        const bx = objective.mesh.position.x;
                        const bz = objective.mesh.position.z;
                        const toBoulder = Math.hypot(px - bx, pz - bz);
                        if (toBoulder < 4.6 && ability === "plough" && vehicle.speed > 1.6) {
                            const nx = (bx - px) / (toBoulder || 1);
                            const nz = (bz - pz) / (toBoulder || 1);
                            const shove = Math.min(vehicle.speed, 14) * dt * 0.9;
                            objective.mesh.position.x += nx * shove;
                            objective.mesh.position.z += nz * shove;
                            objective.mesh.position.y = heightAt(objective.mesh.position.x, objective.mesh.position.z) + 1.6;
                            objective.mesh.rotation.x += shove * 0.4;
                            objective.mesh.rotation.z += nx * shove * 0.3;
                        }
                        const moved = Math.hypot(
                            objective.mesh.position.x - objective.restX,
                            objective.mesh.position.z - objective.restZ
                        );
                        objective.progress = Math.min(1, moved / 12);
                        if (moved > 12) {
                            objective.done = true;
                            changed = true;
                            this.emit("progress", objective.label, mission.colour);
                        }
                    }
                    break;
                }

                default:
                    break;
            }
        }

        /* Fire flicker. */
        mission.objectives.forEach((objective) => {
            if (objective.kind !== "extinguish" || objective.done || !objective.mesh) return;
            objective.mesh.userData.flames.forEach((flame, i) => {
                flame.scale.y = 0.8 + Math.sin(this.time * (7 + i) + i) * 0.22;
                flame.rotation.y += dt * (1 + i * 0.2);
            });
        });

        /* Pickups spin and bob. */
        mission.objectives.forEach((objective) => {
            if (!objective.mesh || objective.done) return;
            if (objective.pickup) {
                objective.mesh.rotation.y += dt * 1.4;
                const base = objective.float ? 0 : objective.y;
                objective.mesh.position.y = base + 1.1 + Math.sin(this.time * 2 + objective.x) * 0.22;
            }
        });

        if (changed) {
            this.updateMarkerVisibility();
            if (mission.objectives.every((o) => o.done)) this.complete(mission);
        }

        return mission;
    }

    consume(objective) {
        if (!objective.mesh) return;
        this.group.remove(objective.mesh);
        objective.mesh.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
        });
        objective.mesh = null;
    }

    complete(mission) {
        let reward = mission.reward;
        if (mission.timeLimit) {
            /* Finishing with time to spare is worth something. */
            const bonus = Math.round((mission.remaining / mission.timeLimit) * mission.reward * 0.4);
            reward += bonus;
        }
        this.treats += reward;
        this.completed += 1;
        this.level = 1 + Math.floor(this.completed / 3);
        this.clearMarkers();
        this.dropCarried();
        this.active = null;
        this.emit("completed", `${mission.title} — ${reward} treats`, 0x6bd66b);
        this.refreshOffers();
    }

    /* What the HUD needs, as plain data. */
    snapshot(vehicle) {
        const mission = this.active;
        const live = this.activeObjectives();
        let nearest = null;
        if (live.length && vehicle) {
            live.forEach((objective) => {
                const d = Math.hypot(vehicle.position.x - objective.x, vehicle.position.z - objective.z);
                if (!nearest || d < nearest.distance) nearest = { objective, distance: d };
            });
        }

        return {
            treats: this.treats,
            completed: this.completed,
            failed: this.failed,
            level: this.level,
            offers: this.offers.map((m) => ({
                id: m.id,
                title: m.title,
                brief: m.brief,
                reward: m.reward,
                kind: m.kind,
                timeLimit: m.timeLimit || 0,
                requiredPup: m.requiredPup || null,
                requiredAnyPup: m.requiredAnyPup || null,
                colour: m.colour,
                distance: Math.round(
                    vehicle ? Math.hypot(vehicle.position.x - m.objectives[0].x, vehicle.position.z - m.objectives[0].z) : 0
                ),
            })),
            active: mission
                ? {
                      id: mission.id,
                      title: mission.title,
                      colour: mission.colour,
                      remaining: mission.timeLimit ? Math.max(0, mission.remaining) : null,
                      timeLimit: mission.timeLimit || null,
                      requiredPup: mission.requiredPup || null,
                      requiredAnyPup: mission.requiredAnyPup || null,
                      done: mission.objectives.filter((o) => o.done).length,
                      total: mission.objectives.length,
                      objective: nearest ? nearest.objective.label : "",
                      distance: nearest ? Math.round(nearest.distance) : 0,
                      progress: nearest ? nearest.objective.progress || 0 : 0,
                  }
                : null,
            markers: live.map((o) => ({ x: o.x, z: o.z, colour: mission ? mission.colour : 0xffffff })),
        };
    }
}

export { TEMPLATES, makeMarker };

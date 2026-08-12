/*
 * The engine: owns the renderer, the world, the vehicle you are driving and
 * the camera watching it. React owns the HUD and nothing else — it is handed a
 * plain snapshot object once a frame and never touches the scene graph.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { heightAt, PLACES, SEA_LEVEL } from "./world";
import { buildGround, buildSea, buildRoadRibbons, buildSky, buildLighting, SUN_DIRECTION } from "./scenery";
import { buildProps, tickWind } from "./props";
import { buildLandmarks } from "./landmarks";
import { obstacles } from "./obstacles";
import { Effects } from "./fx";
import { MissionDirector } from "./missions";
import { GameAudio } from "./audio";
import { buildPupMesh, PupOnFoot } from "./pups";
import { Vehicle, Helicopter, FIXED_DT, clamp } from "./physics";
import { PUPS, pupById, buildVehicleMesh } from "./vehicles";
import { Input } from "./input";

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _euler = new THREE.Euler();

const FOG_COLOR = 0xbfe4ff;

/* Handed to a vehicle nobody is driving. */
const PARKED = { steer: 0, throttle: 0, brake: 0.35, handbrake: true, pitch: 0, lift: 0 };

function yawOf(quaternion) {
    _euler.setFromQuaternion(quaternion, "YXZ");
    return _euler.y;
}

function shortestAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

export class Game {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.onState = options.onState || (() => {});
        this.quality = options.quality || "high";
        this.running = false;
        this.disposed = false;
        this.time = 0;
        this.accumulator = 0;
        this.lastFrame = 0;
        this.frameTimes = [];

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: this.quality !== "low",
            powerPreference: "high-performance",
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === "high" ? 2 : 1.25));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        /* AgX and Reinhard both wash the saturation out of primary colours,
           which is the last thing a Paw Patrol palette needs. ACES keeps the
           reds red while still rolling off the sunlit highlights. */
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.16;
        this.renderer.shadowMap.enabled = this.quality !== "low";
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(FOG_COLOR);
        this.scene.fog = new THREE.Fog(FOG_COLOR, 220, this.quality === "low" ? 520 : 780);

        this.camera = new THREE.PerspectiveCamera(62, 1, 0.4, 3600);
        this.camera.position.set(0, 30, -40);

        /* Bloom. Kept subtle and above a high threshold so it only catches
           siren domes, headlights, chrome and sun on water — enough to make
           the lights feel lit rather than painted, without hazing the whole
           picture into a soft-focus mess. */
        this.useBloom = this.quality === "high";
        if (this.useBloom) {
            this.composer = new EffectComposer(this.renderer);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
            this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.6, 0.86);
            this.composer.addPass(this.bloom);
            this.composer.addPass(new OutputPass());
        }

        this.input = new Input(canvas);

        /* Camera state, smoothed between frames rather than snapped. */
        this.camYaw = 0;
        this.camPos = new THREE.Vector3();
        this.camLook = new THREE.Vector3();
        this.camMode = 0; /* 0 chase, 1 close, 2 far */
        this.lookBack = false;

        this.vehicle = null;
        this.vehicleMesh = null;
        this.pup = PUPS[0];
        this.vehicleCache = new Map();
        this.bodyRadius = 1.5;
        this.obstacles = obstacles;
        this.obstacleScratch = [];
        this.lastCollision = 0;

        this.audio = new GameAudio();
        this.onFoot = false;
        this.pupBody = null;
        this.pupMeshes = new Map();
        this.toasts = [];
        this.abilityActive = false;
        this.sirenOn = false;
        this.abilityHeat = 0;

        this.state = {
            pupId: this.pup.id,
            speed: 0,
            airborne: false,
            grounded: 0,
            place: "",
            fps: 60,
            ready: false,
            missions: null,
            toasts: [],
        };
    }

    /* Browsers keep audio muted until the page has been interacted with, so
       this is called from the first click or keypress rather than at load. */
    async unlockAudio() {
        const ok = await this.audio.resume();
        this.state.audioReady = ok;
        return ok;
    }

    /* ------------------------------------------------------------- *
     * Loading
     * ------------------------------------------------------------- */

    async init(onProgress = () => {}) {
        const report = (fraction, label) => onProgress(clamp(fraction, 0, 1), label);

        report(0.02, "Waking up Adventure Bay");
        this.lights = buildLighting(this.scene);

        report(0.06, "Painting the sky");
        this.sky = buildSky();
        this.scene.add(this.sky);

        report(0.1, "Raising the island");
        this.ground = await buildGround(
            (p) => report(0.1 + p * 0.6, "Raising the island"),
            () => this.yieldFrame()
        );
        if (this.disposed) return;
        this.scene.add(this.ground);

        report(0.72, "Filling the bay");
        this.sea = buildSea();
        this.scene.add(this.sea);
        await this.yieldFrame();

        report(0.76, "Laying the roads");
        this.roadMesh = buildRoadRibbons();
        this.scene.add(this.roadMesh);
        await this.yieldFrame();

        report(0.82, "Planting the woods");
        this.props = buildProps();
        this.scene.add(this.props);
        await this.yieldFrame();

        report(0.92, "Building the town");
        this.landmarks = buildLandmarks();
        this.scene.add(this.landmarks);
        this.animated = this.landmarks.userData.animated;
        await this.yieldFrame();

        report(0.95, "Fuelling the trucks");
        this.effects = new Effects(this.scene);
        this.spawnVehicle(this.pup.id, { x: 92, z: 138, heading: 2.3 });
        await this.yieldFrame();

        report(0.98, "Ryder is on the radio");
        this.missions = new MissionDirector(this.scene, {
            onEvent: (event) => this.pushToast(event),
        });

        report(1, "Ready");
        this.state.ready = true;
    }

    pushToast(event) {
        this.toasts.push({
            id: `${this.time}-${this.toasts.length}`,
            text: event.text,
            type: event.type,
            colour: `#${(event.colour || 0xffffff).toString(16).padStart(6, "0")}`,
            expires: this.time + 4.5,
        });
        if (this.toasts.length > 4) this.toasts.shift();

        if (event.type === "completed") {
            this.audio.success();
            this.effects.confetti(this.vehicle.position.x, this.vehicle.position.y, this.vehicle.position.z);
        } else if (event.type === "progress") this.audio.pickup();
        else if (event.type === "failed") this.audio.failure();
        else if (event.type === "accepted") this.audio.accept();
    }

    /* setTimeout(0) is clamped to 4 ms in the foreground and to a whole second
       in a background tab, which turns thirty yields into a thirty-second
       load. A MessageChannel round trip is neither. */
    yieldFrame() {
        return new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                channel.port1.close();
                resolve();
            };
            channel.port2.postMessage(0);
        });
    }

    /* ------------------------------------------------------------- *
     * Vehicles
     * ------------------------------------------------------------- */

    spawnVehicle(pupId, at) {
        const pup = pupById(pupId);
        const previous = this.vehicle;

        if (this.vehicleMesh) this.vehicleMesh.visible = false;

        let entry = this.vehicleCache.get(pup.id);
        if (!entry) {
            const mesh = buildVehicleMesh(pup);
            this.scene.add(mesh);
            const body = pup.spec.kind === "heli" ? new Helicopter(pup.spec) : new Vehicle(pup.spec);
            entry = { mesh, body };
            this.vehicleCache.set(pup.id, entry);
        }

        const previousMesh = this.vehicleMesh;

        /* Choosing a pup puts you in that pup's truck. Without this you stay
           on foot while the truck you just picked drives itself with the
           handbrake on, which looks exactly like the physics being broken. */
        if (this.onFoot) {
            this.onFoot = false;
            this.pupMeshes.forEach((m) => {
                m.visible = false;
            });
        }

        this.pup = pup;
        this.vehicle = entry.body;
        this.vehicleMesh = entry.mesh;
        this.vehicleMesh.visible = true;
        /* One circle standing in for the whole vehicle when it meets a wall. */
        this.bodyRadius = Math.max(pup.spec.size.x, pup.spec.size.z) * 0.36;

        /* Anyone riding along moves across to the new truck; otherwise they
           stay attached to the hidden one and the rescue can never be
           delivered. */
        if (this.missions && this.missions.carrying && previousMesh && previousMesh !== this.vehicleMesh) {
            const rider = this.missions.carrying;
            previousMesh.remove(rider);
            this.vehicleMesh.add(rider);
            rider.position.set(0, pup.spec.size.y * 0.9, -0.7);
        }

        if (at) {
            const heading = at.heading !== undefined ? at.heading : Math.PI;
            this.vehicle.setTransform(at.x, at.z, heading);
        } else if (previous) {
            /* Swapping pup mid-game: the new truck arrives where you stood. */
            this.vehicle.setTransform(previous.position.x, previous.position.z, yawOf(previous.quaternion));
        }

        this.camYaw = yawOf(this.vehicle.quaternion);
        this.snapCamera();
        this.state.pupId = pup.id;
    }

    cycleVehicle(direction) {
        const index = PUPS.findIndex((p) => p.id === this.pup.id);
        const next = PUPS[(index + direction + PUPS.length) % PUPS.length];
        this.spawnVehicle(next.id, null);
        return next;
    }

    /* ------------------------------------------------------------- *
     * On foot
     *
     * Whatever you are currently controlling — pup or truck — is `actor`.
     * Camera, missions, effects and the HUD all read that, so none of them
     * need to know which it is.
     * ------------------------------------------------------------- */

    get actor() {
        return this.onFoot ? this.pupBody : this.vehicle;
    }

    /* Exposed for tuning from the console. */
    groundAt(x, z) {
        return heightAt(x, z);
    }

    pupMeshFor(pup) {
        let mesh = this.pupMeshes.get(pup.id);
        if (!mesh) {
            mesh = buildPupMesh(pup);
            mesh.visible = false;
            this.scene.add(mesh);
            this.pupMeshes.set(pup.id, mesh);
        }
        return mesh;
    }

    exitVehicle() {
        if (this.onFoot) return;
        const mesh = this.pupMeshFor(this.pup);
        if (!this.pupBody) this.pupBody = new PupOnFoot(mesh);
        else this.pupBody.mesh = mesh;

        /* Step out of the driver's door, on the left. */
        _v.set(-this.pup.spec.size.x * 0.5 - 1.2, 0, 0).applyQuaternion(this.vehicle.quaternion);
        const x = this.vehicle.position.x + _v.x;
        const z = this.vehicle.position.z + _v.z;

        this.pupMeshes.forEach((m) => {
            m.visible = false;
        });
        mesh.visible = true;
        this.pupBody.placeAt(x, z, yawOf(this.vehicle.quaternion));
        this.onFoot = true;
        this.audio.blip(660, 0.1, "sine", 0.1);
    }

    enterVehicle() {
        if (!this.onFoot) return false;
        const distance = Math.hypot(
            this.pupBody.position.x - this.vehicle.position.x,
            this.pupBody.position.z - this.vehicle.position.z
        );
        if (distance > 6.5) return false;
        this.pupBody.mesh.visible = false;
        this.onFoot = false;
        this.audio.blip(520, 0.1, "sine", 0.1);
        return true;
    }

    toggleFoot() {
        if (this.onFoot) {
            if (!this.enterVehicle()) {
                this.pushToast({ type: "hint", text: "Get closer to your truck to climb in", colour: 0xffd23f });
            }
        } else if (this.pup.spec.kind === "heli" && this.vehicle.groundedCount === 0) {
            this.pushToast({ type: "hint", text: "Land first!", colour: 0xffd23f });
        } else {
            this.exitVehicle();
        }
    }

    /* ------------------------------------------------------------- *
     * Loop
     * ------------------------------------------------------------- */

    start() {
        if (this.running) return;
        this.running = true;
        this.lastFrame = performance.now();
        const frame = (now) => {
            if (!this.running) return;
            this.rafId = requestAnimationFrame(frame);
            let dt = (now - this.lastFrame) / 1000;
            this.lastFrame = now;
            /* A backgrounded tab hands back an enormous dt; stepping physics
               through it would fire the car into orbit. */
            if (dt > 0.25) dt = 0.25;
            this.update(dt);
            if (this.composer) this.composer.render();
            else this.renderer.render(this.scene, this.camera);
            this.trackFps(dt);
        };
        this.rafId = requestAnimationFrame(frame);
    }

    stop() {
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
    }

    trackFps(dt) {
        this.frameTimes.push(dt);
        if (this.frameTimes.length > 40) this.frameTimes.shift();
        const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        this.state.fps = Math.round(1 / Math.max(mean, 1e-4));
    }

    update(dt) {
        this.time += dt;
        const raw = this.input.sample();

        this.handleShortcuts();

        const controls = this.mapControls(raw);

        /* Fixed-step physics: variable steps make suspension springs behave
           differently at different frame rates, and the car handles like a
           different car on a slower machine. */
        this.accumulator += dt;
        let steps = 0;
        let hardestHit = 0;
        while (this.accumulator >= FIXED_DT && steps < 8) {
            /* The truck keeps being simulated while you are out of it, so it
               settles on its springs instead of hanging in mid-air. */
            this.vehicle.step(FIXED_DT, this.onFoot ? PARKED : controls);
            const hit = obstacles.resolve(this.vehicle, this.bodyRadius, this.obstacleScratch);
            if (!this.onFoot && hit > hardestHit) hardestHit = hit;

            if (this.onFoot) {
                this.pupBody.step(FIXED_DT, controls, this.camYaw);
            }

            this.accumulator -= FIXED_DT;
            steps += 1;
        }
        if (steps === 8) this.accumulator = 0;
        this.lastCollision = hardestHit;
        if (hardestHit > 2.5) this.audio.thud(hardestHit);

        this.syncVehicleMesh(dt);
        this.updateAbility(dt);
        this.updateEffects(dt);
        this.updateMissions(dt);
        this.updateCamera(dt);
        this.updateSky(dt);
        this.updateAudio();
        this.publishState();
        this.input.endFrame();
    }

    handleShortcuts() {
        if (this.input.consume("camera")) this.camMode = (this.camMode + 1) % 3;
        if (this.input.consume("interact")) this.toggleFoot();
        if (this.input.consume("recover")) {
            const actor = this.actor;
            actor.recover();
            this.effects.burst(actor.position.x, actor.position.y, actor.position.z, 0xffd23f, 14, 5);
        }
        if (this.input.consume("horn")) this.audio.horn();
        this.lookBack = this.input.held("confirm");
        this.abilityActive = !this.onFoot && this.input.held("ability");
    }

    /* ------------------------------------------------------------- *
     * Abilities
     *
     * One key does something different in each truck. Marshall sprays,
     * Chase runs the siren, Rubble and Everest push with the blade. The
     * mission code asks only for the ability *name*, so a template can say
     * "this needs `water`" without knowing who is carrying it.
     * ------------------------------------------------------------- */

    updateAbility(dt) {
        const ability = this.pup.ability;
        const mesh = this.vehicleMesh;
        this.activeAbility = null;

        if (ability === "siren") {
            if (this.input.consume("ability")) this.sirenOn = !this.sirenOn;
            const bar = mesh.userData.lightBar;
            if (bar) {
                const flash = Math.floor(this.time * 6) % 2;
                bar.userData.lamps.forEach((lamp, i) => {
                    lamp.material.emissiveIntensity = this.sirenOn && flash === i ? 2.4 : 0.15;
                });
            }
            if (this.sirenOn) this.activeAbility = "siren";
        } else if (ability === "water") {
            if (this.abilityActive) {
                this.activeAbility = "water";
                /* Out of the nose of the truck, angled up so it arcs. */
                _v.set(0, 1.1, this.pup.spec.size.z * 0.52).applyQuaternion(this.vehicle.quaternion);
                _v.add(this.vehicle.position);
                _v2.set(0, 0.36, 1).applyQuaternion(this.vehicle.quaternion).normalize();
                this.effects.waterJet(_v, _v2);
            }
        } else if (ability === "plough") {
            /* Passive: the blade is always down. */
            this.activeAbility = "plough";
        } else if (ability === "float" || ability === "winch" || ability === "tow") {
            this.activeAbility = this.abilityActive ? ability : null;
        }
    }

    updateEffects(dt) {
        const v = this.actor;
        const fx = this.effects;

        if (this.onFoot) {
            /* A puff of dust off the back paws when running. */
            if (v.grounded && v.speed > 5 && Math.random() < 0.4) {
                fx.spawn(v.position.x, v.position.y + 0.1, v.position.z, 0, 0.7, 0, {
                    colour: 0xcbbf9c,
                    size: 0.5,
                    life: 0.45,
                    alpha: 0.24,
                    gravity: -1.4,
                    drag: 2.4,
                });
            }
            if (v.inWater && v.speed > 1) fx.waterSpray(v.position.x, SEA_LEVEL, v.position.z, v.speed);
            fx.update(dt);
            this.skidLevel = 0;
            return;
        }

        /* Wheel dust and skid marks. */
        let loudestSkid = 0;
        for (let i = 0; i < v.wheels.length; i += 1) {
            const wheel = v.wheels[i];
            if (!wheel.grounded) {
                fx.endSkid(i);
                continue;
            }
            fx.wheelSpray(wheel, v.speed);
            if (wheel.skid > loudestSkid) loudestSkid = wheel.skid;

            if (wheel.skid > 0.28 && v.speed > 3) {
                fx.addSkid(i, wheel.contact.x, wheel.contact.y, wheel.contact.z, wheel.radius * 0.7, wheel.skid);
            } else {
                fx.endSkid(i);
            }
        }
        this.skidLevel = loudestSkid;

        /* Wake, when anything is in the water. */
        if (v.inWater && v.speed > 2) {
            fx.waterSpray(v.position.x, SEA_LEVEL, v.position.z, v.speed);
        }

        /* Rotor downwash kicking up dust and spray. */
        if (this.pup.spec.kind === "heli" && v.rotorSpeed > 12) {
            const groundY = heightAt(v.position.x, v.position.z);
            const altitude = v.position.y - groundY;
            if (altitude < 16 && Math.random() < 0.6) {
                const angle = Math.random() * Math.PI * 2;
                const radius = 3 + Math.random() * 5;
                const x = v.position.x + Math.cos(angle) * radius;
                const z = v.position.z + Math.sin(angle) * radius;
                const y = heightAt(x, z);
                if (y < SEA_LEVEL) fx.waterSpray(x, SEA_LEVEL, z, 12);
                else {
                    fx.spawn(x, y + 0.2, z, Math.cos(angle) * 6, 1.4, Math.sin(angle) * 6, {
                        colour: 0xc8bda6,
                        size: 1.6,
                        life: 0.8,
                        alpha: 0.24 * (1 - altitude / 16),
                        gravity: -1,
                        drag: 1.6,
                    });
                }
            }
        }

        fx.update(dt);
    }

    updateMissions(dt) {
        if (!this.missions) return;
        this.missions.update(dt, {
            /* On foot the pup is the actor: you can walk up and collect a
               stranded kitten just as well as drive to it. */
            vehicle: this.actor,
            vehicleMesh: this.onFoot ? this.pupBody.mesh : this.vehicleMesh,
            pupId: this.pup.id,
            ability: this.activeAbility,
        });
        this.toasts = this.toasts.filter((t) => t.expires > this.time);
    }

    updateAudio() {
        const v = this.actor;
        this.audio.update({
            kind: this.onFoot ? "foot" : this.pup.spec.kind,
            speed: v.speed,
            maxSpeed: this.pup.spec.maxSpeed || 30,
            throttle: v.throttle || 0,
            grounded: v.groundedCount,
            skid: this.skidLevel || 0,
            idle: Math.abs(v.forwardSpeed) < 0.4 && !v.throttle,
            siren: this.sirenOn,
            water: this.activeAbility === "water",
            rotor: v.rotorSpeed || 0,
        });
    }

    /* ------------------------------------------------------------- *
     * Mission plumbing for the HUD
     * ------------------------------------------------------------- */

    acceptMission(id) {
        if (!this.missions) return;
        const mission = this.missions.offers.find((m) => m.id === id);
        if (!mission) return;
        this.missions.accept(id);
        /* Swap to the pup the job needs, so accepting is one click not two. */
        const need = mission.requiredPup || (mission.requiredAnyPup && mission.requiredAnyPup[0]);
        if (need && need !== this.pup.id) this.spawnVehicle(need, null);
    }

    abandonMission() {
        if (this.missions) this.missions.abandon();
    }

    rerollMissions() {
        if (this.missions) this.missions.reroll();
    }

    /* Raw input means different things depending on what you are sitting in. */
    mapControls(raw) {
        if (this.onFoot) {
            return {
                steer: raw.steer,
                throttle: raw.throttle,
                brake: raw.brake,
                /* Space jumps, Shift runs. */
                jump: this.input.held("handbrake"),
                handbrake: this.input.held("descend"),
                pitch: 0,
                lift: 0,
            };
        }

        if (this.pup.spec.kind === "heli") {
            /* W must drop the nose and fly you forwards, and D must yaw right.
               Both were inverted: the sign conventions in the flight model run
               opposite to the ones on the ground. */
            return {
                throttle: raw.throttle,
                pitch: -(raw.throttle - raw.brake),
                roll: raw.rollLeft ? -1 : 0,
                yaw: raw.steer,
                lift: raw.lift,
                steer: raw.steer,
                brake: 0,
                handbrake: false,
            };
        }

        /* Down is brake while rolling forward, reverse once stopped — one key
           doing the obvious thing rather than a separate reverse gear. */
        const rolling = this.vehicle.forwardSpeed;
        let throttle = raw.throttle;
        let brake = 0;
        if (raw.brake > 0) {
            if (rolling > 1.2) brake = raw.brake;
            else throttle = -raw.brake;
        }

        return {
            steer: raw.steer,
            throttle,
            brake,
            handbrake: raw.handbrake,
            pitch: raw.throttle - raw.brake,
            lift: raw.lift,
        };
    }

    syncVehicleMesh(dt) {
        const v = this.vehicle;
        const mesh = this.vehicleMesh;
        mesh.position.copy(v.position);
        mesh.quaternion.copy(v.quaternion);

        const wheelMeshes = mesh.userData.wheels || [];
        for (let i = 0; i < wheelMeshes.length; i += 1) {
            const wheel = v.wheels[i];
            if (!wheel) break;
            const wm = wheelMeshes[i];
            const drop = this.pup.spec.suspensionRest - wheel.compression;
            wm.position.set(wheel.local.x, wheel.local.y - drop, wheel.local.z);
            wm.rotation.x = wheel.spin;
            wm.rotation.y = wheel.steering ? v.steer : 0;
        }

        if (mesh.userData.rotor) {
            mesh.userData.rotor.rotation.y += v.rotorSpeed * dt;
            mesh.userData.tailRotor.rotation.z -= v.rotorSpeed * 1.6 * dt;
        }
        if (mesh.userData.fan) {
            mesh.userData.fan.rotation.z += (6 + Math.abs(v.forwardSpeed) * 1.4) * dt;
        }
    }

    /* ------------------------------------------------------------- *
     * Camera
     *
     * Follows the direction of travel rather than the nose of the car, so a
     * drift shows you the corner instead of the inside of the hedge.
     * ------------------------------------------------------------- */

    cameraRig() {
        if (this.onFoot) return { distance: 5.6, height: 2.4, lookAhead: 3.0, lag: 4.5 };
        const heli = this.pup.spec.kind === "heli";
        if (heli) return { distance: 15, height: 5.4, lookAhead: 8, lag: 3.2 };
        const long = this.pup.spec.size.z;
        switch (this.camMode) {
            case 1:
                return { distance: long * 1.5, height: long * 0.42, lookAhead: 5, lag: 7 };
            case 2:
                return { distance: long * 3.6, height: long * 1.1, lookAhead: 10, lag: 3.4 };
            default:
                return { distance: long * 2.3, height: long * 0.72, lookAhead: 7, lag: 4.6 };
        }
    }

    desiredCameraYaw() {
        if (this.onFoot) return this.pupBody.heading;
        const v = this.vehicle;
        const bodyYaw = yawOf(v.quaternion);
        if (this.pup.spec.kind === "heli") return bodyYaw;

        const planarSpeed = Math.hypot(v.velocity.x, v.velocity.z);
        if (planarSpeed < 2.5) return bodyYaw;

        const travelYaw = Math.atan2(v.velocity.x, v.velocity.z);
        /* Reversing should not swing the camera round the front of the car. */
        const backwards = v.forwardSpeed < -0.5;
        if (backwards) return bodyYaw;

        const blend = clamp((planarSpeed - 2.5) / 12, 0, 1) * 0.55;
        return bodyYaw + shortestAngle(bodyYaw, travelYaw) * blend;
    }

    snapCamera() {
        const rig = this.cameraRig();
        const v = this.actor;
        this.camPos.set(
            v.position.x - Math.sin(this.camYaw) * rig.distance,
            v.position.y + rig.height,
            v.position.z - Math.cos(this.camYaw) * rig.distance
        );
        this.camLook.copy(v.position);
        this.camera.position.copy(this.camPos);
        this.camera.lookAt(this.camLook);
    }

    updateCamera(dt) {
        const v = this.actor;
        const rig = this.cameraRig();

        let targetYaw = this.desiredCameraYaw();
        if (this.lookBack) targetYaw += Math.PI;

        this.camYaw += shortestAngle(this.camYaw, targetYaw) * Math.min(1, dt * rig.lag);

        const forwardX = Math.sin(this.camYaw);
        const forwardZ = Math.cos(this.camYaw);

        /* Pull back and up a little as speed rises. */
        const rush = clamp(v.speed / 30, 0, 1);
        const distance = rig.distance * (1 + rush * 0.22);
        const height = rig.height * (1 + rush * 0.14);

        _v.set(
            v.position.x - forwardX * distance,
            v.position.y + height,
            v.position.z - forwardZ * distance
        );

        /* Never let the ground come between the camera and the car. */
        const groundHere = heightAt(_v.x, _v.z);
        const floor = Math.max(groundHere, SEA_LEVEL - 1) + 1.8;
        if (_v.y < floor) _v.y = floor;

        const follow = 1 - Math.pow(0.0016, dt);
        this.camPos.lerp(_v, follow);

        _v2.set(
            v.position.x + forwardX * rig.lookAhead,
            v.position.y + (this.onFoot ? 1.0 : this.pup.spec.kind === "heli" ? 0.5 : 1.1),
            v.position.z + forwardZ * rig.lookAhead
        );
        this.camLook.lerp(_v2, 1 - Math.pow(0.0009, dt));

        this.camera.position.copy(this.camPos);
        this.camera.lookAt(this.camLook);

        /* A touch of extra field of view at speed. Small, but it is most of
           what makes fast feel fast. */
        const targetFov = 62 + rush * 12;
        this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
        this.camera.updateProjectionMatrix();

        /* Keep the shadow frustum on the car rather than on the origin. */
        const sun = this.lights.sun;
        sun.position.copy(v.position).addScaledVector(SUN_DIRECTION, 180);
        sun.target.position.copy(v.position);
        sun.target.updateMatrixWorld();
    }

    updateSky(dt) {
        tickWind(this.time);

        const animated = this.animated;
        if (animated) {
            if (animated.mill) animated.mill.rotation.z += dt * 0.7;
            if (animated.lighthouse) {
                /* One rotation every four seconds; the lamp brightens as the
                   beam comes round to face you. */
                const sweep = (this.time * 0.42) % 1;
                const beacon = animated.lighthouse.userData.beacon;
                const pulse = Math.pow(Math.max(0, Math.sin(sweep * Math.PI * 2)), 6);
                beacon.intensity = 40 + pulse * 900;
                animated.lighthouse.userData.lampRoom.material.emissiveIntensity = 0.4 + pulse * 1.6;
            }
            if (animated.harbour && animated.harbour.userData.boat) {
                const boat = animated.harbour.userData.boat;
                boat.position.y = 0.5 + Math.sin(this.time * 1.1) * 0.16;
                boat.rotation.z = Math.sin(this.time * 0.9) * 0.05;
            }
        }

        this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
        const clouds = this.sky.userData.clouds;
        for (let i = 0; i < clouds.children.length; i += 1) {
            const cloud = clouds.children[i];
            cloud.position.x += cloud.userData.drift * dt * 2.2;
            if (cloud.position.x > 1400) cloud.position.x = -1400;
        }
        if (this.sea) this.sea.material.uniforms.uTime.value = this.time;
        if (this.sea) this.sea.position.set(this.camera.position.x, SEA_LEVEL, this.camera.position.z);
    }

    nearestPlace() {
        const v = this.actor.position;
        let best = null;
        let bestDistance = Infinity;
        for (const place of PLACES) {
            const d = Math.hypot(place.x - v.x, place.z - v.z);
            if (d < bestDistance) {
                bestDistance = d;
                best = place;
            }
        }
        return bestDistance < 150 ? best : null;
    }

    publishState() {
        const v = this.actor;
        const place = this.nearestPlace();
        this.state.onFoot = this.onFoot;
        this.state.speed = Math.round(v.speed * 3.6);
        this.state.airborne = v.groundedCount === 0 && v.airborneFor > 0.25;
        this.state.grounded = v.groundedCount;
        this.state.place = place ? place.name : "";
        this.state.pupId = this.pup.id;
        this.state.altitude = Math.max(0, v.position.y - heightAt(v.position.x, v.position.z));
        this.state.upsideDown = v.upsideDownFor > 1.2;
        this.state.x = v.position.x;
        this.state.z = v.position.z;
        this.state.heading = this.onFoot ? v.heading : yawOf(v.quaternion);
        this.state.siren = this.sirenOn;
        this.state.ability = this.activeAbility;
        this.state.inWater = v.inWater;
        this.state.missions = this.missions ? this.missions.snapshot(v) : null;
        this.state.toasts = this.toasts;
        this.onState(this.state);
    }

    /* ------------------------------------------------------------- *
     * Housekeeping
     * ------------------------------------------------------------- */

    resize(width, height) {
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / Math.max(1, height);
        this.camera.updateProjectionMatrix();
        if (this.composer) {
            this.composer.setSize(width, height);
            this.bloom.setSize(width, height);
        }
    }

    dispose() {
        this.disposed = true;
        this.stop();
        this.input.dispose();
        this.audio.dispose();
        this.scene.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
            const material = object.material;
            if (Array.isArray(material)) material.forEach((m) => m.dispose());
            else if (material) {
                Object.values(material).forEach((value) => {
                    if (value && value.isTexture) value.dispose();
                });
                material.dispose();
            }
        });
        this.renderer.dispose();
    }
}

export { PUPS, pupById };

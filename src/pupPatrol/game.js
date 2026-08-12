/*
 * The engine: owns the renderer, the world, the vehicle you are driving and
 * the camera watching it. React owns the HUD and nothing else — it is handed a
 * plain snapshot object once a frame and never touches the scene graph.
 */

import * as THREE from "three";
import { heightAt, nearestRoadPoint, placeById, PLACES, SEA_LEVEL } from "./world";
import {
    buildGround,
    buildSea,
    buildRoadRibbons,
    buildSky,
    buildLighting,
    buildDistantLands,
    SUN_DIRECTION,
    HORIZON_COLOUR,
} from "./scenery";
import { buildProps, tickWind } from "./props";
import { GroundCover } from "./groundcover";
import { buildLandmarks } from "./landmarks";
import { obstacles } from "./obstacles";
import { Effects } from "./fx";
import { MissionDirector } from "./missions";
import { GameAudio } from "./audio";
import { buildPupMesh, PupOnFoot } from "./pups";
import { Vehicle, Helicopter, FIXED_DT, clamp } from "./physics";
import { PUPS, pupById, buildVehicleMesh } from "./vehicles";
import { Input } from "./input";
import { CameraRig, CAMERA_MODES } from "./camera";
import { PostFX, ShadowRig, buildEnvironment, qualityFor, detectQuality } from "./render";

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _euler = new THREE.Euler();

/* Handed to a vehicle nobody is driving. */
const PARKED = { steer: 0, throttle: 0, brake: 0.35, handbrake: true, pitch: 0, lift: 0 };

const GEAR_LABELS = ["R", "N", "1", "2", "3", "4", "5", "6", "7"];

function yawOf(quaternion) {
    _euler.setFromQuaternion(quaternion, "YXZ");
    return _euler.y;
}

export class Game {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.onState = options.onState || (() => {});
        this.qualityName = options.quality || detectQuality();
        this.quality = qualityFor(this.qualityName);
        this.running = false;
        this.paused = false;
        this.disposed = false;
        this.time = 0;
        this.accumulator = 0;
        this.lastFrame = 0;
        this.frameTimes = [];

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: false /* SMAA in the post chain does a better job */,
            powerPreference: "high-performance",
            stencil: false,
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        /* Tone mapping happens in the grade pass, which also does the grading
           and the transfer function — one pass instead of three. */
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.shadowMap.enabled = this.quality.shadows;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(HORIZON_COLOUR);
        this.scene.fog = new THREE.Fog(
            HORIZON_COLOUR,
            this.quality.drawDistance * 0.3,
            this.quality.drawDistance
        );

        this.camera = new THREE.PerspectiveCamera(62, 1, 0.6, 9000);
        this.camera.position.set(0, 30, -40);

        /* What every metal and painted surface in the game is reflecting. */
        this.environment = buildEnvironment(this.renderer, { sunDirection: SUN_DIRECTION });
        this.scene.environment = this.environment;

        this.postfx = new PostFX(this.renderer, this.scene, this.camera, this.quality);

        this.input = new Input(canvas);
        this.rig = new CameraRig(this.camera);
        this.rig.obstacles = obstacles;
        this.rig.heightAt = heightAt;
        this.rig.seaLevel = SEA_LEVEL;

        this.vehicle = null;
        this.vehicleMesh = null;
        this.pup = PUPS[0];
        this.vehicleCache = new Map();
        this.bodyRadius = 1.5;
        this.obstacles = obstacles;
        this.obstacleScratch = [];
        this.lastCollision = 0;
        this.wasAirborne = false;
        this.airTime = 0;
        this.bestAir = 0;

        this.audio = new GameAudio();
        this.onFoot = false;
        this.pupBody = null;
        this.pupMeshes = new Map();
        this.toasts = [];
        this.abilityActive = false;
        this.sirenOn = false;
        this.controls = { ...PARKED };
        this.raw = { steer: 0, throttle: 0, brake: 0, lift: 0, lookX: 0, lookY: 0, looking: false, zoom: 0 };
        this.driftTime = 0;
        this.flash = 0;

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
            quality: this.qualityName,
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
        this.lights = buildLighting(this.scene, this.quality);
        if (this.quality.shadows) this.shadowRig = new ShadowRig(this.lights.sun, this.quality);

        report(0.05, "Painting the sky");
        this.sky = buildSky();
        this.scene.add(this.sky);

        report(0.07, "Raising the far islands");
        this.horizon = buildDistantLands();
        this.scene.add(this.horizon);
        await this.yieldFrame();

        report(0.1, "Raising the island");
        this.ground = await buildGround(
            (p) => report(0.1 + p * 0.58, "Raising the island"),
            () => this.yieldFrame(),
            this.quality
        );
        if (this.disposed) return;
        this.scene.add(this.ground);

        report(0.7, "Filling the bay");
        this.sea = buildSea(this.quality);
        this.scene.add(this.sea);
        await this.yieldFrame();

        report(0.75, "Laying the roads");
        this.roadMesh = buildRoadRibbons(this.quality);
        this.scene.add(this.roadMesh);
        await this.yieldFrame();

        report(0.82, "Planting the woods");
        this.props = buildProps();
        this.scene.add(this.props);
        await this.yieldFrame();

        report(0.9, "Growing the grass");
        this.cover = new GroundCover(this.scene, this.quality.cover);
        await this.yieldFrame();

        report(0.92, "Building the town");
        this.landmarks = buildLandmarks();
        this.scene.add(this.landmarks);
        this.animated = this.landmarks.userData.animated;
        await this.yieldFrame();

        report(0.95, "Fuelling the trucks");
        this.effects = new Effects(this.scene);
        /* On the road outside the Lookout, pointing down it. */
        const lookout = placeById("lookout");
        this.spawnPoint = nearestRoadPoint(lookout.x, lookout.z);
        this.spawnVehicle(this.pup.id, this.spawnPoint);
        await this.yieldFrame();

        report(0.98, "Ryder is on the radio");
        this.missions = new MissionDirector(this.scene, {
            onEvent: (event) => this.pushToast(event),
        });

        /* Compiling every shader now costs a second here and saves a stutter
           the first time anything new comes on screen. */
        this.renderer.compile(this.scene, this.camera);

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
            this.flash = 0.12;
            this.input.rumble(0.3, 0.6, 300);
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

        /* Bonnet cam on a helicopter would put you inside the rotor mast. */
        if (pup.spec.kind === "heli" && CAMERA_MODES[this.rig.mode].bonnet) this.rig.mode = 0;

        this.rig.snap(this.cameraContext());
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
        if (CAMERA_MODES[this.rig.mode].bonnet) this.rig.mode = 0;
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
               through it would fire the car into orbit. The cap is a tenth of
               a second because that is exactly what the substep budget below
               can cover — asking for a quarter and then refusing to simulate
               it just means the world quietly runs at a third speed. */
            if (dt > 0.1) dt = 0.1;
            this.update(dt);
            this.postfx.render(this.scene, this.camera, dt);
            this.trackFps(dt);
        };
        this.rafId = requestAnimationFrame(frame);
    }

    stop() {
        this.running = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
    }

    setPaused(paused) {
        this.paused = paused;
        if (paused) {
            this.audio.silence();
            /* Whatever was held when the menu opened must not still be held
               when it closes, or you come back to a car at full throttle. */
            this.input.keys.clear();
            this.input.setTouch({ steer: 0, throttle: 0, brake: 0, lift: 0, handbrake: false });
            this.controls = { ...PARKED, brake: 1, throttle: 0 };
        }
    }

    trackFps(dt) {
        this.frameTimes.push(dt);
        if (this.frameTimes.length > 40) this.frameTimes.shift();
        const mean = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        this.state.fps = Math.round(1 / Math.max(mean, 1e-4));
    }

    update(dt) {
        this.time += dt;
        const raw = this.input.sample(dt);
        this.raw = raw;

        this.handleShortcuts();

        if (this.paused) {
            this.updateCamera(dt);
            this.updateSky(dt);
            this.publishState();
            this.input.endFrame();
            return;
        }

        const controls = this.mapControls(raw);
        this.controls = controls;

        /* Fixed-step physics: variable steps make suspension springs behave
           differently at different frame rates, and the car handles like a
           different car on a slower machine. */
        this.accumulator += dt;
        let steps = 0;
        let hardestHit = 0;
        while (this.accumulator >= FIXED_DT && steps < 12) {
            /* The truck keeps being simulated while you are out of it, so it
               settles on its springs instead of hanging in mid-air. */
            this.vehicle.step(FIXED_DT, this.onFoot ? PARKED : controls);
            const hit = obstacles.resolve(this.vehicle, this.bodyRadius, this.obstacleScratch);
            if (!this.onFoot && hit > hardestHit) hardestHit = hit;

            if (this.onFoot) {
                this.pupBody.step(FIXED_DT, controls, this.rig.yaw);
            }

            this.accumulator -= FIXED_DT;
            steps += 1;
        }
        if (steps === 12) this.accumulator = 0;
        this.lastCollision = hardestHit;
        if (hardestHit > 2.5) this.registerImpact(hardestHit);

        this.trackFlight(dt);
        this.syncVehicleMesh(dt);
        this.updateAbility(dt);
        this.updateLights(dt);
        this.updateEffects(dt);
        this.updateMissions(dt);
        this.updateCamera(dt);
        this.updateSky(dt);
        this.updateAudio();
        this.publishState();
        this.input.endFrame();
    }

    /* Everything that should happen when the truck hits something, in one
       place, so a sound, a shake, a rumble and a puff never get out of step. */
    registerImpact(force) {
        this.audio.thud(force);
        this.rig.addTrauma(clamp(force / 16, 0.06, 0.85));
        this.input.rumble(clamp(force / 20, 0, 1), 0.4, 140);
        this.flash = Math.max(this.flash, clamp(force / 90, 0, 0.14));
        if (force > 6 && this.effects) {
            this.effects.debris(
                this.vehicle.position.x,
                this.vehicle.position.y - this.pup.spec.size.y * 0.3,
                this.vehicle.position.z,
                Math.min(14, Math.round(force))
            );
        }
    }

    /* Air time, so a jump can be scored and a landing can land. */
    trackFlight(dt) {
        if (this.onFoot) {
            /* Leaving the truck mid-jump used to freeze the air-time readout
               at whatever it happened to be, so the HUD cheerfully announced
               a permanent 0.6-second jump while the pup stood on the grass. */
            this.airTime = 0;
            this.wasAirborne = false;
            return;
        }
        const airborne = this.vehicle.groundedCount === 0;
        if (airborne) {
            this.airTime += dt;
            this.wasAirborne = true;
        } else if (this.wasAirborne) {
            this.wasAirborne = false;
            if (this.airTime > 0.35) {
                const weight = clamp(this.airTime / 1.6, 0.1, 1);
                this.rig.addTrauma(weight * 0.5);
                this.audio.landing(weight);
                this.input.rumble(weight * 0.7, 0.3, 160);
                if (this.airTime > this.bestAir) this.bestAir = this.airTime;
                if (this.effects) {
                    for (const wheel of this.vehicle.wheels) {
                        if (!wheel.grounded) continue;
                        this.effects.wheelSpray(wheel, 16);
                    }
                }
            }
            this.airTime = 0;
        }
    }

    handleShortcuts() {
        if (this.input.consume("camera")) {
            const mode = this.rig.cycle();
            if (mode.bonnet && (this.onFoot || this.pup.spec.kind === "heli")) this.rig.cycle();
            this.pushToast({ type: "hint", text: `Camera: ${this.rig.modeInfo.name}`, colour: 0x9fd8ff });
        }
        if (this.input.consume("interact")) this.toggleFoot();
        if (this.input.consume("recover")) {
            const actor = this.actor;
            actor.recover();
            this.effects.burst(actor.position.x, actor.position.y, actor.position.z, 0xffd23f, 14, 5);
        }
        if (this.input.consume("horn")) this.audio.horn();
        this.lookBack = this.input.held("confirm");
        this.rig.lookBack = this.lookBack;
        this.abilityActive = !this.onFoot && this.input.held("ability");

        const digit = this.input.consumeDigit();
        if (digit > 0 && digit <= PUPS.length) this.spawnVehicle(PUPS[digit - 1].id, null);
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
                bar.userData.lamps.forEach((dome, i) => {
                    dome.material.emissiveIntensity = this.sirenOn && flash === i ? 3.6 : 0.15;
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
            const beacon = mesh.userData.beacon;
            if (beacon) beacon.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(this.time * 4)) * 2.2;
        } else if (ability === "float" || ability === "winch" || ability === "tow") {
            this.activeAbility = this.abilityActive ? ability : null;
        }
    }

    /* Lamps that react. The back of a truck telling you it is braking is a
       small thing that makes every other vehicle on the island legible. */
    updateLights(dt) {
        const ud = this.vehicleMesh.userData;
        const v = this.vehicle;
        const braking = !this.onFoot && (this.controls.brake > 0.05 || this.controls.handbrake);
        const reversing = !this.onFoot && v.reversing && Math.abs(v.forwardSpeed) > 0.4;

        const ease = (light, target) => {
            const m = light.material;
            m.emissiveIntensity += (target - m.emissiveIntensity) * Math.min(1, dt * 22);
        };

        if (ud.brakeLights) ud.brakeLights.forEach((l) => ease(l, braking ? 3.4 : 0.3));
        if (ud.reverseLights) ud.reverseLights.forEach((l) => ease(l, reversing ? 2.6 : 0.04));
        if (ud.headlights) {
            /* Brighter in the shade of the mountain and under the canopy,
               which is the only "night" this island has. */
            const shaded = clamp(1 - (v.position.y + 20) / 90, 0, 1);
            ud.headlights.forEach((l) => ease(l, 0.4 + shaded * 0.9));
        }

        if (ud.rotorDisc) {
            const spin = clamp((v.rotorSpeed || 0) / (this.pup.spec.rotorMax || 34), 0, 1);
            ud.rotorDisc.material.opacity = clamp((spin - 0.35) / 0.45, 0, 1) * 0.3;
        }
        if (ud.beacon && this.pup.spec.kind === "heli") {
            ud.beacon.material.emissiveIntensity = Math.floor(this.time * 1.6) % 2 ? 2.6 : 0.2;
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

            if (wheel.skid > 0.24 && v.speed > 3) {
                fx.addSkid(i, wheel.contact.x, wheel.contact.y, wheel.contact.z, wheel.radius * 0.7, wheel.skid);
            } else {
                fx.endSkid(i);
            }
        }
        this.skidLevel = loudestSkid;

        /* Exhaust, when the engine is working. Almost invisible at a cruise
           and a proper puff when you plant it, which is the only feedback
           there is that the throttle did something before the car moves. */
        if (v.wheels.length && this.controls.throttle > 0.5 && Math.random() < 0.35) {
            const anchor = this.vehicleMesh.userData.exhaust;
            if (anchor) {
                _v.copy(anchor).applyQuaternion(v.quaternion).add(v.position);
                _v2.set(0, 0, -1).applyQuaternion(v.quaternion);
                fx.spawn(_v.x, _v.y, _v.z, _v2.x * 2.4, 0.9, _v2.z * 2.4, {
                    colour: 0xb9b7b0,
                    size: 0.45,
                    life: 0.5,
                    alpha: 0.16 + v.wheelspin * 0.12,
                    gravity: 0.9,
                    drag: 2.2,
                });
            }
        }

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
        const spec = this.pup.spec;
        this.audio.update({
            kind: this.onFoot ? "foot" : spec.kind,
            speed: v.speed,
            maxSpeed: spec.maxSpeed || 30,
            throttle: Math.abs(this.controls.throttle || 0),
            grounded: v.groundedCount,
            skid: this.skidLevel || 0,
            idle: Math.abs(v.forwardSpeed) < 0.4 && !this.controls.throttle,
            siren: this.sirenOn,
            water: this.activeAbility === "water",
            rotor: v.rotorSpeed || 0,
            rotorMax: spec.rotorMax || 34,
            rpm: v.rpm || 0,
            maxRpm: (v.drivetrain && v.drivetrain.maxRpm) || 6400,
            gear: v.gear || 0,
            shifting: (v.shiftTimer || 0) > 0,
            wheelspin: v.wheelspin || 0,
            inWater: v.inWater,
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
            wm.rotation.y = wheel.steerAngle || 0;
        }

        if (mesh.userData.rotor) {
            mesh.userData.rotor.rotation.y += v.rotorSpeed * dt;
            mesh.userData.tailRotor.rotation.z -= v.rotorSpeed * 1.6 * dt;
        }
        if (mesh.userData.fan) {
            mesh.userData.fan.rotation.z += (6 + Math.abs(v.forwardSpeed) * 1.4) * dt;
        }

        /* The driver leans against the cornering force and ducks under
           braking. Two lines, and suddenly somebody is driving. */
        const driver = mesh.userData.driver;
        if (driver && !this.onFoot) {
            const lean = clamp(-v.lateralSpeed * 0.05, -0.32, 0.32);
            driver.rotation.z += (lean - driver.rotation.z) * Math.min(1, dt * 6);
            const pitch = clamp((this.controls.brake || 0) * 0.16 - (this.controls.throttle || 0) * 0.06, -0.2, 0.2);
            driver.rotation.x += (pitch - driver.rotation.x) * Math.min(1, dt * 6);
        }
    }

    /* ------------------------------------------------------------- *
     * Camera
     * ------------------------------------------------------------- */

    cameraContext() {
        const v = this.actor;
        const spec = this.pup.spec;
        return {
            position: v.position,
            velocity: v.velocity,
            quaternion: v.quaternion,
            heading: this.onFoot ? v.heading : 0,
            forwardSpeed: v.forwardSpeed || 0,
            lateral: this.onFoot ? 0 : v.lateralSpeed || 0,
            braking: this.onFoot ? 0 : this.controls.brake || 0,
            speed: v.speed,
            onFoot: this.onFoot,
            kind: this.onFoot ? "foot" : spec.kind,
            size: spec.size,
            look: { x: this.raw.lookX || 0, y: this.raw.lookY || 0, active: this.raw.looking },
            zoom: this.raw.zoom || 0,
        };
    }

    updateCamera(dt) {
        this.rig.update(dt, this.cameraContext());

        if (this.shadowRig) {
            const v = this.actor;
            _forward.set(0, 0, 1).applyQuaternion(this.camera.quaternion);
            this.shadowRig.update(dt, v.position, _forward, v.speed, SUN_DIRECTION);
        }

        const spec = this.pup.spec;
        this.postfx.update(dt, {
            speedRatio: clamp(this.actor.speed / (spec.maxSpeed || 30), 0, 1.2),
            submerged: this.camera.position.y < SEA_LEVEL + 0.4,
            flash: this.flash,
        });
        this.flash = 0;
    }

    updateSky(dt) {
        tickWind(this.time);

        /* Grass follows the camera, not the car: at the far end of a long
           free-look the two are eighty metres apart, and it is the camera that
           decides what is on screen. */
        if (this.cover) {
            this.cover.update(this.camera.position.x, this.camera.position.z);
            this.cover.flush(this.time);
        }

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
            const span = cloud.userData.span;
            if (cloud.position.x > span) cloud.position.x = -span;
        }
        if (this.sea) {
            this.sea.material.uniforms.uTime.value = this.time;
            this.sea.position.set(this.camera.position.x, SEA_LEVEL, this.camera.position.z);
        }
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
        const spec = this.pup.spec;
        const drivetrain = v.drivetrain;

        this.state.onFoot = this.onFoot;
        this.state.speed = Math.round(v.speed * 3.6);
        this.state.speedRatio = clamp(v.speed / (spec.maxSpeed || 30), 0, 1);
        this.state.airborne = v.groundedCount === 0 && v.airborneFor > 0.25;
        this.state.airTime = this.airTime;
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
        this.state.paused = this.paused;
        this.state.camera = this.rig.modeInfo.name;
        this.state.missions = this.missions ? this.missions.snapshot(v) : null;
        this.state.toasts = this.toasts;

        if (this.onFoot || !drivetrain) {
            this.state.rpm = 0;
            this.state.rpmRatio = 0;
            this.state.gear = "—";
            this.state.drift = 0;
        } else {
            this.state.rpm = Math.round(v.rpm);
            this.state.rpmRatio = clamp(v.rpm / drivetrain.maxRpm, 0, 1);
            this.state.gear = v.reversing ? "R" : GEAR_LABELS[v.gear + 1] || String(v.gear);
            this.state.drift = clamp((v.driftAngle - 0.14) * 3, 0, 1);
        }

        this.onState(this.state);
    }

    /* ------------------------------------------------------------- *
     * Housekeeping
     * ------------------------------------------------------------- */

    resize(width, height) {
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / Math.max(1, height);
        this.camera.updateProjectionMatrix();
        this.postfx.setSize(width, height);
    }

    dispose() {
        this.disposed = true;
        this.stop();
        this.input.dispose();
        this.audio.dispose();
        this.postfx.dispose();
        if (this.environment) this.environment.dispose();
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

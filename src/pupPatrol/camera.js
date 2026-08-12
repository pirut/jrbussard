/*
 * The camera.
 *
 * More of how a driving game feels lives here than anywhere except the tyres.
 * A camera bolted rigidly behind the car tells you nothing; one that lags,
 * leans, widens and shakes tells you how fast you are going, how hard you are
 * turning and how badly you just landed — without a single number on screen.
 *
 * What it does:
 *
 *   follows the direction of travel, not the nose, so a drift shows you the
 *   corner instead of the inside of the hedge;
 *
 *   trails on a critically damped spring rather than a linear lerp, so it
 *   settles without overshoot at any frame rate;
 *
 *   never lets terrain or a building get between itself and the car;
 *
 *   widens and drops as speed builds, and rolls a few degrees into a corner,
 *   which is the cheapest convincing sense of load there is;
 *
 *   shakes on impacts and landings, from a single decaying "trauma" value —
 *   squared, so small knocks are almost nothing and a real hit is violent.
 */

import * as THREE from "three";

const _desired = new THREE.Vector3();
const _target = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _euler = new THREE.Euler();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function shortestAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

function yawOf(quaternion) {
    _euler.setFromQuaternion(quaternion, "YXZ");
    return _euler.y;
}

/* Frame-rate independent exponential approach: the fraction of the remaining
   distance to cover this frame, given a rate in "e-folds per second". */
function smoothing(rate, dt) {
    return 1 - Math.exp(-rate * dt);
}

/*
 * Modes.
 *
 * `height` and `distance` are multiples of the vehicle's own length, so a fire
 * engine gets a camera proportional to a fire engine without any per-vehicle
 * tuning. `stiffness` is how hard the spring pulls; low is cinematic and
 * floaty, high is tight and arcade.
 */
export const CAMERA_MODES = [
    { id: "chase", name: "Chase", distance: 1.95, height: 0.6, lookAhead: 7, stiffness: 7.5, fov: 60 },
    { id: "close", name: "Close", distance: 1.35, height: 0.42, lookAhead: 5, stiffness: 11, fov: 64 },
    { id: "far", name: "Wide", distance: 3.1, height: 1.0, lookAhead: 10, stiffness: 5.2, fov: 56 },
    { id: "hood", name: "Bonnet", distance: 0, height: 0, lookAhead: 14, stiffness: 22, fov: 72, bonnet: true },
];

export class CameraRig {
    constructor(camera) {
        this.camera = camera;
        this.mode = 0;
        this.yaw = 0;
        this.pitch = 0;
        this.freeYaw = 0;
        this.freePitch = 0;
        this.zoom = 0;
        this.roll = 0;
        this.trauma = 0;
        this.shakeTime = 0;
        this.lookBack = false;
        this.position = new THREE.Vector3();
        this.look = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.fov = 62;
        this.obstacles = null;
        this.obstacleScratch = [];
        this.heightAt = () => 0;
        this.seaLevel = 0;
    }

    get modeInfo() {
        return CAMERA_MODES[this.mode];
    }

    cycle() {
        this.mode = (this.mode + 1) % CAMERA_MODES.length;
        return this.modeInfo;
    }

    /* Trauma accumulates and decays; the shake it produces is its square, so
       a scrape is barely visible and a head-on is unmissable. */
    addTrauma(amount) {
        this.trauma = clamp(this.trauma + amount, 0, 1);
    }

    rig(context) {
        const mode = CAMERA_MODES[this.mode];
        if (context.onFoot) {
            return { distance: 5.6, height: 2.5, lookAhead: 3.2, stiffness: 9, fov: 64, bonnet: false };
        }
        if (context.kind === "heli") {
            return { distance: 15.5, height: 5.6, lookAhead: 9, stiffness: 4.6, fov: 62, bonnet: false };
        }
        const length = context.size.z;
        return {
            distance: mode.distance * length,
            height: mode.height * length,
            lookAhead: mode.lookAhead,
            stiffness: mode.stiffness,
            fov: mode.fov,
            bonnet: !!mode.bonnet,
        };
    }

    desiredYaw(context) {
        if (context.onFoot) return context.heading;
        const bodyYaw = yawOf(context.quaternion);
        if (context.kind === "heli") return bodyYaw;

        const planar = Math.hypot(context.velocity.x, context.velocity.z);
        if (planar < 2.5) return bodyYaw;
        /* Reversing should not swing the camera round the front of the car. */
        if (context.forwardSpeed < -0.5) return bodyYaw;

        const travelYaw = Math.atan2(context.velocity.x, context.velocity.z);
        const blend = clamp((planar - 2.5) / 12, 0, 1) * 0.55;
        return bodyYaw + shortestAngle(bodyYaw, travelYaw) * blend;
    }

    /* Nothing solid may come between the camera and the car. Walk the segment
       from the car outward and stop at the first thing in the way; a camera
       that clips into a hillside for half a second is the most jarring thing a
       third-person game can do. */
    clearPath(from, to) {
        const steps = 7;
        let limit = 1;
        for (let i = 1; i <= steps; i += 1) {
            const t = i / steps;
            _probe.lerpVectors(from, to, t);
            const ground = Math.max(this.heightAt(_probe.x, _probe.z), this.seaLevel - 0.6) + 1.4;
            if (_probe.y < ground) {
                limit = Math.min(limit, Math.max(0.18, t - 1 / steps));
                break;
            }
        }

        if (this.obstacles) {
            const list = this.obstacles.near(to.x, to.z, this.obstacleScratch);
            for (let i = 0; i < list.length; i += 1) {
                const item = list[i];
                if (!item.solid) continue;
                /* Trees count, but only their trunks. Testing a tree at its
                   full collision radius would have the camera lurching in and
                   out every time you drove past a canopy; testing it at trunk
                   width means the camera tucks in when something would
                   genuinely be in front of the lens, and ignores the leaves. */
                const radius = item.kind === "tree" ? item.radius * 0.55 : item.radius;
                for (let s = 1; s <= steps; s += 1) {
                    const t = s / steps;
                    _probe.lerpVectors(from, to, t);
                    if (_probe.y > item.top) continue;
                    const dx = _probe.x - item.x;
                    const dz = _probe.z - item.z;
                    if (dx * dx + dz * dz < radius * radius) {
                        limit = Math.min(limit, Math.max(0.18, t - 1 / steps));
                        break;
                    }
                }
            }
        }
        return limit;
    }

    snap(context) {
        const rig = this.rig(context);
        this.yaw = this.desiredYaw(context);
        this.pitch = 0;
        this.freeYaw = 0;
        this.freePitch = 0;
        this.roll = 0;
        this.trauma = 0;
        this.position.set(
            context.position.x - Math.sin(this.yaw) * rig.distance,
            context.position.y + rig.height,
            context.position.z - Math.cos(this.yaw) * rig.distance
        );
        this.look.copy(context.position);
        this.camera.position.copy(this.position);
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(this.look);
        this.camera.fov = rig.fov;
        this.fov = rig.fov;
        this.camera.updateProjectionMatrix();
    }

    update(dt, context) {
        const rig = this.rig(context);

        /* ---- free look ---- */
        const look = context.look || { x: 0, y: 0, active: false };
        this.freeYaw = clamp(this.freeYaw - look.x, -Math.PI, Math.PI);
        this.freePitch = clamp(this.freePitch + look.y, -0.5, 0.85);
        if (!look.active) {
            /* Drift back behind the car once you let go, but only while
               actually driving — standing still and looking around should
               stay where you put it. */
            const recentre = smoothing(context.speed > 3 ? 2.2 : 0.35, dt);
            this.freeYaw -= this.freeYaw * recentre;
            this.freePitch -= this.freePitch * recentre;
        }
        if (context.zoom) this.zoom = clamp(this.zoom + context.zoom, -0.45, 1.6);

        /* ---- orientation ---- */
        let targetYaw = this.desiredYaw(context) + this.freeYaw;
        if (this.lookBack) targetYaw += Math.PI;
        this.yaw += shortestAngle(this.yaw, targetYaw) * smoothing(rig.stiffness * 0.62, dt);

        const rush = clamp(context.speed / 30, 0, 1);

        if (rig.bonnet) {
            this.updateBonnet(dt, context, rig, rush);
            return;
        }

        const forwardX = Math.sin(this.yaw);
        const forwardZ = Math.cos(this.yaw);

        /* Pull back and up a little as speed rises, plus whatever the player
           has dialled in with the wheel. */
        const zoomScale = 1 + this.zoom;
        const distance = rig.distance * (1 + rush * 0.24) * zoomScale;
        const height = rig.height * (1 + rush * 0.16) * zoomScale + this.freePitch * rig.distance * 0.8;

        _target.set(
            context.position.x,
            context.position.y + (context.onFoot ? 1.0 : context.kind === "heli" ? 0.6 : context.size.y * 0.55),
            context.position.z
        );

        _desired.set(
            context.position.x - forwardX * distance,
            context.position.y + height,
            context.position.z - forwardZ * distance
        );

        /* Never let the ground come between the camera and the car. */
        const floor = Math.max(this.heightAt(_desired.x, _desired.z), this.seaLevel - 1) + 1.7;
        if (_desired.y < floor) _desired.y = floor;

        const clearance = this.clearPath(_target, _desired);
        if (clearance < 1) _desired.lerpVectors(_target, _desired, clearance);

        /* ---- critically damped spring ----
         *
         * x'' = -2*w*x' - w^2*(x - target). Integrated semi-implicitly, which
         * for a critically damped system is stable at any step this game will
         * ever take and never overshoots — a plain lerp with a per-frame
         * constant is neither of those things when the frame rate moves. */
        const omega = rig.stiffness;
        _offset.subVectors(this.position, _desired);
        this.velocity.addScaledVector(_offset, -omega * omega * dt);
        this.velocity.multiplyScalar(Math.max(0, 1 - 2 * omega * dt));
        this.position.addScaledVector(this.velocity, dt);
        /* A hard leash. If the car teleports — a respawn, a pup swap — the
           spring would take a second to catch up and the world would smear. */
        if (this.position.distanceToSquared(_desired) > 900) {
            this.position.copy(_desired);
            this.velocity.set(0, 0, 0);
        }

        /* ---- where it points ---- */
        _offset.set(
            context.position.x + forwardX * rig.lookAhead * (0.55 + rush * 0.45),
            _target.y + rush * 0.6,
            context.position.z + forwardZ * rig.lookAhead * (0.55 + rush * 0.45)
        );
        this.look.lerp(_offset, smoothing(rig.stiffness * 1.15, dt));

        this.apply(dt, context, rig, rush);
    }

    /* Bonnet cam: rigidly attached, because the whole point is that you feel
       every bump through it. Only the roll is softened, or a kerb strike makes
       the horizon jump hard enough to be unpleasant. */
    updateBonnet(dt, context, rig, rush) {
        _forward.set(0, 0, 1).applyQuaternion(context.quaternion);
        _up.set(0, 1, 0).applyQuaternion(context.quaternion);

        this.position
            .copy(context.position)
            .addScaledVector(_forward, context.size.z * 0.16)
            .addScaledVector(_up, context.size.y * 0.62);

        this.look
            .copy(this.position)
            .addScaledVector(_forward, rig.lookAhead)
            .addScaledVector(_up, this.freePitch * -6);

        /* Free look swings the view, not the car. */
        if (this.freeYaw !== 0) {
            const s = Math.sin(this.freeYaw);
            const c = Math.cos(this.freeYaw);
            const dx = this.look.x - this.position.x;
            const dz = this.look.z - this.position.z;
            this.look.x = this.position.x + dx * c - dz * s;
            this.look.z = this.position.z + dx * s + dz * c;
        }

        this.apply(dt, context, rig, rush, _up);
    }

    apply(dt, context, rig, rush, upVector) {
        const camera = this.camera;

        /* ---- roll ----
           A few degrees of lean into the corner. Real cameras do not do this;
           real cameras are also not bolted to a cartoon fire engine, and the
           lean is most of what sells cornering load at this speed. */
        const targetRoll = clamp(-context.lateral * 0.02, -0.13, 0.13) * (rig.bonnet ? 0.45 : 1);
        this.roll += (targetRoll - this.roll) * smoothing(4.5, dt);

        /* ---- shake ---- */
        this.trauma = Math.max(0, this.trauma - dt * 1.35);
        this.shakeTime += dt;
        const shake = this.trauma * this.trauma;
        let shakeYaw = 0;
        let shakePitch = 0;
        if (shake > 0.0004) {
            const t = this.shakeTime * 34;
            shakeYaw = Math.sin(t * 1.31) * shake * 0.09;
            shakePitch = Math.sin(t * 1.77 + 1.3) * shake * 0.07;
            this.position.y += Math.sin(t * 2.13) * shake * 0.35;
            this.position.x += Math.sin(t * 1.61 + 2.1) * shake * 0.28;
            this.position.z += Math.sin(t * 1.93 + 0.7) * shake * 0.28;
        }

        /* Last line of defence.
         *
         * The desired position is already tested against the terrain and
         * against buildings, but the spring takes time to reach it and on a
         * steep hillside the *path* it travels can go straight through the
         * hill. One clamp on the final position, every frame, is what
         * guarantees the camera is never underground — and being underground
         * for even three frames is the single most alarming thing a
         * third-person camera can do, because the world turns black. */
        const floor = Math.max(this.heightAt(this.position.x, this.position.z), this.seaLevel - 1) + 1.2;
        if (this.position.y < floor) this.position.y = floor;

        camera.position.copy(this.position);

        /* Roll is applied through the up vector rather than by rotating after
           lookAt, which would fight it on the very next frame. */
        _forward.subVectors(this.look, this.position).normalize();
        _up.copy(upVector || WORLD_UP).applyAxisAngle(_forward, this.roll + shakeYaw * 0.5);
        camera.up.copy(_up);

        _offset.copy(this.look);
        if (shakePitch !== 0) _offset.y += shakePitch * 4;
        camera.lookAt(_offset);

        /* ---- field of view ----
           A touch more at speed. Small, but it is most of what makes fast feel
           fast, and pulling it back in under braking makes stopping feel like
           stopping. */
        const targetFov = rig.fov + rush * rush * 13 - clamp(context.braking, 0, 1) * 3;
        this.fov += (targetFov - this.fov) * smoothing(3.2, dt);
        if (Math.abs(camera.fov - this.fov) > 0.01) {
            camera.fov = this.fov;
            camera.updateProjectionMatrix();
        }
    }
}

/*
 * Vehicle physics.
 *
 * A rigid body — position, orientation, linear and angular velocity — with
 * raycast wheels on spring suspension hanging off it. Everything the vehicle
 * does comes out of forces at the contact patches: it squats under power, leans
 * into corners, unloads the inside wheels, lands nose-first off a jump and can
 * be spun by braking mid-corner. None of that is scripted.
 *
 * The tyres are the part that matters. Each wheel carries its own angular
 * velocity, integrated from drive torque, brake torque and the reaction from
 * the road, so the wheel can spin faster than the car (wheelspin) or slower
 * (lockup) instead of being welded to road speed. Force comes from a combined
 * slip curve that rises to a peak and then *falls away*, which is the whole
 * difference between a car that understeers into a hedge and a car that steps
 * its tail out, holds a slide and comes back when you lift.
 *
 * Body axes: +Z forward, +X right, +Y up.
 */

import * as THREE from "three";
import { heightAt, normalAt, surfaceAt, SURFACE_INFO, SEA_LEVEL, WORLD_HALF } from "./world";

/* Arcade gravity. Higher than earth on purpose: jumps come back down inside a
   readable arc instead of hanging, and the whole island feels like a toy set
   rather than a simulator. Every force in the game is tuned against it. */
export const GRAVITY = 22;
export const FIXED_DT = 1 / 120;

const RPM_TO_RAD = Math.PI / 30;
const RAD_TO_RPM = 30 / Math.PI;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _torqueArm = new THREE.Vector3();
const _rollPoint = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _bodyTorque = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _euler = new THREE.Euler();

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/* Underside sample points, as fractions of half-width and half-length. Pulled
   well inside the outline: probing the very corners means the tail touches
   down every time the truck squats under power, which is not what a floor
   scrape should mean. */
const CHASSIS_PROBES = [
    [0, 0.72],
    [0, -0.72],
    [-0.8, 0.5],
    [0.8, 0.5],
    [-0.8, -0.5],
    [0.8, -0.5],
    [0, 0],
];

/* --------------------------------------------------------------- *
 * Ground query
 *
 * The terrain is a heightfield, so "cast a ray" is really "find where this
 * line crosses h(x, z)". For a near-vertical ray, three fixed-point steps land
 * within a centimetre — cheaper and steadier than marching along it.
 * --------------------------------------------------------------- */

const groundHit = { x: 0, y: 0, z: 0, distance: 0, hit: false, normal: new THREE.Vector3(), surface: 0 };

function castToGround(originX, originY, originZ, dir, maxDistance, out) {
    /* Guard against a ray that has tipped past horizontal; at that point the
       heightfield solve has no answer and the wheel is off the ground anyway. */
    const dy = dir.y > -0.2 ? -0.2 : dir.y;
    const reach = maxDistance * 1.6;

    let t = 0;
    let x = originX;
    let z = originZ;
    let h = heightAt(originX, originZ);
    for (let i = 0; i < 3; i += 1) {
        t = clamp((h - originY) / dy, 0, reach);
        x = originX + dir.x * t;
        z = originZ + dir.z * t;
        h = heightAt(x, z);
    }

    out.x = x;
    out.y = h;
    out.z = z;
    out.distance = t;
    out.hit = t <= maxDistance;
    normalAt(x, z, out.normal);
    out.surface = surfaceAt(x, z);
    return out;
}

export function groundProbe(x, y, z, maxDistance = 6) {
    return castToGround(x, y, z, _v4.set(0, -1, 0), maxDistance, groundHit);
}

/* --------------------------------------------------------------- *
 * Tyre
 *
 * One normalised curve serves both directions. `s` is how far past the peak
 * slip the tyre is, combining longitudinal and lateral slip as a vector — a
 * tyre has one budget of grip and spending it sideways leaves none for
 * driving, which is exactly why you cannot power out of a slide you have
 * already overcooked.
 *
 * Below the peak the curve rises with zero gradient at the top, so grip does
 * not switch on and off at a threshold. Past it, force *decays* toward a
 * plateau rather than staying pinned at maximum: that decay is what makes a
 * slide something you have to catch instead of something the car catches for
 * you, and it is the single biggest reason this now feels like driving.
 * --------------------------------------------------------------- */

const SLIDE_PLATEAU = 0.72;

function tyreCurve(s) {
    if (s <= 0) return 0;
    if (s < 1) return s * (2 - s);
    return SLIDE_PLATEAU + (1 - SLIDE_PLATEAU) * Math.exp(-(s - 1) * 1.35);
}

/* Gradient of the curve at zero slip, for the implicit wheel-spin solve. */
const TYRE_STIFFNESS_AT_ZERO = 2;

/* --------------------------------------------------------------- *
 * Drivetrain
 *
 * The specs are written in the units that are easy to reason about — "this
 * truck does 34 m/s and pushes 16 kN" — and the gearing is solved backwards
 * from those two numbers. That way adding a pup means picking a top speed and
 * a shove, not hand-fitting five gear ratios.
 * --------------------------------------------------------------- */

const DEFAULT_GEARS = [3.42, 2.14, 1.52, 1.14, 0.88];

function torqueFactor(x) {
    /* Normalised torque against normalised rpm. Peaks around 73% of the
       redline and falls off after, so there is a reason to change gear and a
       reason not to bounce off the limiter. */
    if (x <= 0) return 0.6;
    const f = 0.6 + 1.05 * x - 0.72 * x * x;
    return clamp(f / 0.9829, 0, 1.02);
}

export function deriveDrivetrain(spec) {
    if (spec._drivetrain) return spec._drivetrain;

    const gears = spec.gears || DEFAULT_GEARS;
    const maxRpm = spec.maxRpm || 6400;
    const idleRpm = spec.idleRpm || 780;
    const radius = spec.wheels && spec.wheels.length ? spec.wheels[0].radius : 0.45;
    const top = gears[gears.length - 1];

    /* Final drive sized so top gear at the redline is exactly the quoted top
       speed. Everything else follows from there. */
    const finalDrive = (maxRpm * RPM_TO_RAD * radius) / (top * Math.max(spec.maxSpeed, 4));
    /* Peak torque sized so first gear at peak rpm gives the quoted shove. */
    const peakTorque = (spec.engineForce * radius) / (gears[0] * finalDrive);

    const drivetrain = {
        gears,
        reverse: spec.reverseGear || -gears[0] * 0.86,
        finalDrive,
        peakTorque,
        maxRpm,
        idleRpm,
        shiftUp: spec.shiftUp || maxRpm * 0.93,
        shiftDown: spec.shiftDown || maxRpm * 0.42,
        shiftTime: spec.shiftTime || 0.17,
        efficiency: 0.92,
        engineBrake: spec.engineBrake || 0.09,
    };
    spec._drivetrain = drivetrain;
    return drivetrain;
}

/* --------------------------------------------------------------- *
 * Vehicle
 * --------------------------------------------------------------- */

export class Vehicle {
    constructor(spec) {
        this.spec = spec;
        this.drivetrain = deriveDrivetrain(spec);
        this.mass = spec.mass;
        this.position = new THREE.Vector3();
        this.quaternion = new THREE.Quaternion();
        this.velocity = new THREE.Vector3();
        this.angularVelocity = new THREE.Vector3();

        this.forceAccum = new THREE.Vector3();
        this.torqueAccum = new THREE.Vector3();

        const { size } = spec;
        const m = spec.mass;
        /* Solid-box inertia. A car is not a solid box, but the ratios between
           the three axes are what matters for how it rolls and yaws, and those
           are close enough that tuning the numbers by feel is easier than
           modelling the real mass distribution. */
        this.inertiaLocal = new THREE.Vector3(
            (m * (size.y * size.y + size.z * size.z)) / 12,
            (m * (size.x * size.x + size.z * size.z)) / 12,
            (m * (size.x * size.x + size.y * size.y)) / 12
        ).multiply(spec.inertiaScale || new THREE.Vector3(1, 1, 1));
        this.invInertiaLocal = new THREE.Vector3(
            1 / this.inertiaLocal.x,
            1 / this.inertiaLocal.y,
            1 / this.inertiaLocal.z
        );

        /* Nominal vertical load per wheel, used to make grip load-sensitive:
           a tyre carrying twice its share does not give twice the grip, which
           is the reason weight transfer costs you time. */
        this.nominalLoad = (m * GRAVITY) / Math.max(1, spec.wheels.length);

        this.wheels = spec.wheels.map((w) => {
            const inertia = 0.5 * (spec.mass * 0.018 + 8) * w.radius * w.radius;
            return {
                local: new THREE.Vector3(w.x, w.y, w.z),
                radius: w.radius,
                steering: !!w.steering,
                powered: !!w.powered,
                handbrake: !!w.handbrake,
                inertia,
                invInertia: 1 / inertia,
                /* runtime */
                compression: 0,
                lastCompression: 0,
                grounded: false,
                load: 0,
                omega: 0,
                spin: 0,
                spinSpeed: 0,
                steerAngle: 0,
                slipRatio: 0,
                slipAngle: 0,
                slip: 0,
                skid: 0,
                surface: 0,
                worldPos: new THREE.Vector3(),
                contact: new THREE.Vector3(),
                contactNormal: new THREE.Vector3(0, 1, 0),
            };
        });

        this.steer = 0;
        this.steerTarget = 0;
        this.throttle = 0;
        this.brake = 0;
        this.handbrake = 0;
        this.groundedCount = 0;
        this.speed = 0;
        this.forwardSpeed = 0;
        this.lateralSpeed = 0;
        this.engineLoad = 0;
        this.inWater = false;
        this.waterDepth = 0;
        this.upsideDownFor = 0;
        this.airborneFor = 0;
        this.lastImpact = 0;
        this.odometer = 0;
        this.lateralG = 0;
        this.driftAngle = 0;

        /* Drivetrain state. */
        this.gear = 1; /* 0 = neutral/reverse handled by sign, 1..n forward */
        this.rpm = this.drivetrain.idleRpm;
        this.shiftTimer = 0;
        this.lastShift = 0;
        this.reversing = false;
        this.wheelspin = 0;

        this.poweredCount = this.wheels.filter((w) => w.powered).length || 1;
        this.wheelbase = Math.max(
            0.5,
            Math.max(...spec.wheels.map((w) => w.z)) - Math.min(...spec.wheels.map((w) => w.z))
        );
        this.track = Math.max(0.5, Math.max(...spec.wheels.map((w) => Math.abs(w.x))) * 2);

        /* Reusable scratch so a physics step allocates nothing. */
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._up = new THREE.Vector3();
    }

    setTransform(x, z, heading) {
        this.position.set(x, heightAt(x, z) + this.spec.spawnHeight, z);
        this.quaternion.setFromAxisAngle(_v1.set(0, 1, 0), heading);
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.wheels.forEach((w) => {
            w.omega = 0;
            w.slipRatio = 0;
            w.slipAngle = 0;
            w.skid = 0;
        });
        this.gear = 1;
        this.rpm = this.drivetrain.idleRpm;
        this.shiftTimer = 0;
    }

    axes() {
        this._forward.set(0, 0, 1).applyQuaternion(this.quaternion);
        this._right.set(1, 0, 0).applyQuaternion(this.quaternion);
        this._up.set(0, 1, 0).applyQuaternion(this.quaternion);
    }

    /* Callers routinely pass one of the shared scratch vectors as `force`, so
       this must not touch any of them — computing the arm into the same vector
       makes r x r, every wheel torque comes out zero, and the car glides
       around perfectly flat wondering why it never leans. */
    applyForce(force, worldPoint) {
        this.forceAccum.add(force);
        _torqueArm.subVectors(worldPoint, this.position).cross(force);
        this.torqueAccum.add(_torqueArm);
    }

    worldVelocityAt(worldPoint, out) {
        out.subVectors(worldPoint, this.position).cross(this.angularVelocity).negate().add(this.velocity);
        return out;
    }

    /* omega += I^-1 * torque * dt, with I^-1 in world space = R diag(1/I) R^T.
       Done by rotating the torque into body space, scaling by the diagonal,
       and rotating back — no matrices needed. */
    applyAngularImpulse(torque, dt, out) {
        _bodyTorque.copy(torque).applyQuaternion(_q2.copy(this.quaternion).invert());
        _bodyTorque.x *= this.invInertiaLocal.x;
        _bodyTorque.y *= this.invInertiaLocal.y;
        _bodyTorque.z *= this.invInertiaLocal.z;
        _bodyTorque.applyQuaternion(this.quaternion);
        out.addScaledVector(_bodyTorque, dt);
    }

    /* ----------------------------------------------------------- *
     * Gearbox
     *
     * Automatic, because the audience is five. It still shifts properly:
     * torque is cut for the duration of the change, which you can hear and
     * feel as the car goes light for a fraction of a second.
     * ----------------------------------------------------------- */

    updateGearbox(dt, wantReverse) {
        const dt3 = this.drivetrain;
        const drivenOmega = this.averageDrivenOmega();

        if (this.shiftTimer > 0) this.shiftTimer -= dt;

        this.reversing = wantReverse;
        const ratio = wantReverse ? dt3.reverse : dt3.gears[this.gear - 1];
        const shaftRpm = Math.abs(drivenOmega * ratio * dt3.finalDrive) * RAD_TO_RPM;
        this.rpm += (Math.max(dt3.idleRpm, shaftRpm) - this.rpm) * Math.min(1, dt * 18);
        /* Blip toward the limiter when the clutch is effectively open at a
           standstill, so flooring it from rest sounds like flooring it. */
        if (Math.abs(drivenOmega) < 1 && this.throttle > 0.1) {
            this.rpm +=
                (dt3.idleRpm + this.throttle * (dt3.maxRpm - dt3.idleRpm) * 0.55 - this.rpm) * Math.min(1, dt * 5);
        }
        this.rpm = clamp(this.rpm, dt3.idleRpm, dt3.maxRpm);

        if (wantReverse || this.shiftTimer > 0) return;

        /* Shift on road speed, not on the tachometer.
         *
         * Reading the rev counter is the obvious thing and it is wrong: a
         * wheel spinning in the air, or on ice, pins the needle at the
         * limiter, and the box ladders straight up through every gear in
         * about a second and sits in top at walking pace. What a real
         * automatic responds to is how fast the *car* is going, so that is
         * what this asks. */
        const radius = this.wheels.length ? this.wheels[0].radius : 0.45;
        const roadRpm =
            (Math.abs(this.forwardSpeed) / radius) * Math.abs(ratio) * dt3.finalDrive * RAD_TO_RPM;

        if (roadRpm > dt3.shiftUp && this.gear < dt3.gears.length && this.throttle > 0.05) {
            this.gear += 1;
            this.shiftTimer = dt3.shiftTime;
            this.lastShift = 1;
        } else if (roadRpm < dt3.shiftDown && this.gear > 1) {
            this.gear -= 1;
            this.shiftTimer = dt3.shiftTime * 0.6;
            this.lastShift = -1;
        }
    }

    /* The fastest a driven wheel can turn in the current gear. The engine
       cannot exceed its redline, and the gearbox is what ties the two
       together — without this a wheel that leaves the ground under power
       accelerates without limit and comes back down doing four hundred. */
    maxDrivenOmega() {
        const dt3 = this.drivetrain;
        const ratio = Math.abs(this.reversing ? dt3.reverse : dt3.gears[this.gear - 1]);
        return (dt3.maxRpm * RPM_TO_RAD) / Math.max(0.05, ratio * dt3.finalDrive);
    }

    averageDrivenOmega() {
        let total = 0;
        let count = 0;
        for (let i = 0; i < this.wheels.length; i += 1) {
            if (!this.wheels[i].powered) continue;
            total += this.wheels[i].omega;
            count += 1;
        }
        return count ? total / count : 0;
    }

    /* Torque arriving at one driven wheel, in newton-metres. */
    driveTorque() {
        const dt3 = this.drivetrain;
        if (this.shiftTimer > 0) return 0;
        if (this.throttle === 0) return 0;
        const ratio = this.reversing ? dt3.reverse : dt3.gears[this.gear - 1];
        const factor = torqueFactor(this.rpm / dt3.maxRpm);
        /* Soft limiter rather than a wall. */
        const limiter = this.rpm > dt3.maxRpm * 0.995 ? 0.25 : 1;
        const engine = dt3.peakTorque * factor * Math.abs(this.throttle) * limiter;
        return (engine * ratio * dt3.finalDrive * dt3.efficiency) / this.poweredCount;
    }

    /* ----------------------------------------------------------- *
     * Step
     * ----------------------------------------------------------- */

    step(dt, controls) {
        const spec = this.spec;
        this.forceAccum.set(0, 0, 0);
        this.torqueAccum.set(0, 0, 0);
        this.axes();

        const forward = this._forward;
        const right = this._right;
        const up = this._up;

        this.speed = this.velocity.length();
        this.forwardSpeed = this.velocity.dot(forward);
        this.lateralSpeed = this.velocity.dot(right);

        /* Planar speed drives every "how fast am I really going" decision;
           the vertical component of a jump should not sharpen the steering. */
        const planar = Math.hypot(this.velocity.x, this.velocity.z);
        this.driftAngle = planar > 2 ? Math.abs(Math.atan2(this.lateralSpeed, Math.abs(this.forwardSpeed) + 0.5)) : 0;

        /* ---- steering ------------------------------------------------ *
         *
         * Lock falls away with speed, but not to a fixed fraction: what
         * matters is that the *lateral acceleration* a full-lock input asks
         * for stays inside what the tyres can deliver. Ask for more than that
         * and the front simply washes out, which feels like the steering has
         * stopped working. Solving for the angle that requests roughly one
         * gravity of cornering keeps full lock always meaning "as much as
         * this thing can actually do".
         */
        const speedFactor = 1 - clamp(Math.abs(this.forwardSpeed) / spec.steerFalloff, 0, 0.72);
        let steerLimit = spec.steerMax * speedFactor;
        if (planar > 6) {
            const gripLimit = Math.atan(((spec.corneringLimit || 24) * this.wheelbase) / (planar * planar));
            steerLimit = Math.min(steerLimit, Math.max(0.055, gripLimit));
        }

        /* Counter-steer assist. Once the back is out, allow — and gently
           encourage — more lock into the slide than the limiter would give,
           so catching it is possible for hands that are not expert. */
        const assist = spec.counterSteer || 0;
        const slideDirection = -sign(this.lateralSpeed);
        let target = controls.steer * steerLimit;
        if (assist > 0 && this.driftAngle > 0.12 && Math.abs(this.forwardSpeed) > 4) {
            const help = clamp((this.driftAngle - 0.12) * 2.4, 0, 1) * assist;
            target += slideDirection * spec.steerMax * help;
            target = clamp(target, -spec.steerMax, spec.steerMax);
        }
        this.steerTarget = target;

        /* Rate-limited, and quicker to return to centre than away from it —
           real steering self-centres and it makes small corrections feel
           crisp instead of syrupy. */
        const returning = Math.abs(this.steerTarget) < Math.abs(this.steer) && this.steerTarget * this.steer >= 0;
        const steerRate = spec.steerSpeed * (returning ? 1.7 : 1) * dt;
        this.steer += clamp(this.steerTarget - this.steer, -steerRate, steerRate);

        this.throttle = controls.throttle;
        this.brake = controls.brake;
        this.handbrake = controls.handbrake ? 1 : 0;

        this.updateGearbox(dt, this.throttle < 0);
        const wheelDrive = this.driveTorque();
        const omegaCeiling = this.maxDrivenOmega() * 1.06;

        /* ---- gravity -------------------------------------------------- */
        this.forceAccum.y -= this.mass * GRAVITY;

        /* ---- wheels --------------------------------------------------- */
        let grounded = 0;
        let worstSpin = 0;

        for (let i = 0; i < this.wheels.length; i += 1) {
            const wheel = this.wheels[i];
            wheel.worldPos.copy(wheel.local).applyQuaternion(this.quaternion).add(this.position);

            /* Ackermann: the inside wheel of a turn traces a tighter circle
               and has to point further in. Without it both front tyres fight
               each other through every slow corner and the car scrubs. */
            if (wheel.steering) {
                const inner = wheel.local.x * this.steer > 0;
                const geo = spec.ackermann === undefined ? 0.75 : spec.ackermann;
                const offset = (this.track * 0.5) * geo;
                const radius = this.wheelbase / Math.max(Math.tan(Math.abs(this.steer)), 1e-4);
                const adjusted = Math.atan(this.wheelbase / Math.max(0.4, radius + (inner ? -offset : offset)));
                wheel.steerAngle = sign(this.steer) * adjusted;
            } else {
                wheel.steerAngle = 0;
            }

            const maxReach = spec.suspensionRest + spec.suspensionTravel + wheel.radius;
            _v3.copy(up).negate();
            const hit = castToGround(wheel.worldPos.x, wheel.worldPos.y, wheel.worldPos.z, _v3, maxReach, groundHit);

            const contactDistance = hit.distance;
            const restDistance = spec.suspensionRest + wheel.radius;

            if (!hit.hit || contactDistance > restDistance + spec.suspensionTravel) {
                wheel.grounded = false;
                wheel.load = 0;
                wheel.compression = Math.max(0, wheel.compression - dt * 6);
                wheel.skid *= 0.9;
                wheel.slipRatio *= 0.85;
                wheel.slipAngle *= 0.85;
                /* In the air a driven wheel still spins up under power, and an
                   undriven one slowly winds down. Both are visible. */
                const airDrive = wheel.powered ? wheelDrive * wheel.invInertia * dt : 0;
                wheel.omega += airDrive;
                if (this.brake > 0 || this.throttle === 0) {
                    wheel.omega -= wheel.omega * Math.min(1, dt * (this.brake > 0 ? 6 : 1.2));
                }
                if (wheel.powered) wheel.omega = clamp(wheel.omega, -omegaCeiling, omegaCeiling);
                wheel.spin += wheel.omega * dt;
                wheel.spinSpeed = wheel.omega;
                continue;
            }

            grounded += 1;
            wheel.grounded = true;
            wheel.contact.set(hit.x, hit.y, hit.z);
            wheel.contactNormal.copy(hit.normal);
            wheel.surface = hit.surface;

            const compression = clamp(restDistance - contactDistance, 0, spec.suspensionTravel);
            const compressionVelocity = (compression - wheel.lastCompression) / dt;
            wheel.lastCompression = compression;
            wheel.compression = compression;

            /* Asymmetric damping: firm on rebound, softer on compression. It
               is what stops a heavy truck pogoing off every kerb. */
            const damping = compressionVelocity > 0 ? spec.suspensionDamping : spec.suspensionDamping * 1.55;
            let normalForce = spec.suspensionStiffness * compression + damping * compressionVelocity;
            /* Springs push, they never pull the car down onto the road. */
            if (normalForce < 0) normalForce = 0;
            if (normalForce > spec.suspensionMaxForce) normalForce = spec.suspensionMaxForce;
            wheel.load = normalForce;

            /* Along the contact normal, but scaled by how square the car is to
               the ground: on a steep bank a wheel should not launch you
               sideways at full spring force. */
            const align = clamp(wheel.contactNormal.dot(up), 0.25, 1);
            _v1.copy(wheel.contactNormal).multiplyScalar(normalForce * align);
            this.applyForce(_v1, wheel.contact);

            /* ---- tyre basis, in the plane of the ground ---- */
            _v2.copy(forward).applyAxisAngle(up, wheel.steerAngle);
            /* Project onto the contact plane and renormalise. */
            _v2.addScaledVector(wheel.contactNormal, -_v2.dot(wheel.contactNormal)).normalize();
            _v3.crossVectors(wheel.contactNormal, _v2).normalize(); /* points left */

            this.worldVelocityAt(wheel.contact, _v1);
            const vLong = _v1.dot(_v2);
            const vLat = _v1.dot(_v3);

            const surfaceInfo = SURFACE_INFO[hit.surface] || SURFACE_INFO[0];
            /* Load sensitivity: grip per newton falls as the tyre is squashed
               harder, so the loaded outside wheel cannot fully make up for the
               unloaded inside one. This is what gives weight transfer a cost. */
            const loadRatio = normalForce / this.nominalLoad;
            const sensitivity = 1 - clamp((loadRatio - 1) * (spec.loadSensitivity ?? 0.18), -0.35, 0.4);
            const mu = spec.grip * surfaceInfo.grip * sensitivity;
            const capacity = mu * normalForce;

            /* Reference speed for turning velocities into slips. Floored so
               the maths stays finite at a standstill; the floor is also what
               makes the tyre behave like static friction when barely moving. */
            const vRef = Math.max(Math.abs(vLong), 2.2);

            const slipRatio = (wheel.omega * wheel.radius - vLong) / vRef;
            const slipAngle = Math.atan2(vLat, vRef);
            wheel.slipRatio = slipRatio;
            wheel.slipAngle = slipAngle;

            const peakRatio = spec.peakSlipRatio || 0.16;
            let peakAngle = spec.peakSlipAngle || 0.16;
            if (wheel.handbrake && this.handbrake) peakAngle *= 3.4;

            const sx = slipRatio / peakRatio;
            const sy = Math.tan(slipAngle) / peakAngle;
            const s = Math.hypot(sx, sy);

            let longForce = 0;
            let latForce = 0;
            if (s > 1e-5) {
                const magnitude = capacity * tyreCurve(s);
                longForce = (sx / s) * magnitude;
                latForce = -(sy / s) * magnitude;
            }
            wheel.slip = clamp(s - 1, 0, 2) * 0.5;

            /* ---- wheel spin ----
             *
             * Integrated implicitly against the tyre's own stiffness. Doing it
             * explicitly at 120 Hz makes the wheel overshoot the grip peak and
             * back again every step, and the car buzzes as though the road
             * were corrugated. The implicit form is unconditionally stable and
             * costs one divide. */
            let brakeTorque = (this.brake * spec.brakeForce * wheel.radius) / this.wheels.length;
            if (wheel.handbrake && this.handbrake) {
                brakeTorque += spec.handbrakeForce ?? spec.brakeForce * 0.55 * wheel.radius;
            }
            /* Engine braking, only through the driven wheels and only off the
               throttle. Multiplied up through the gearing exactly as the drive
               torque is, so second gear holds you back down a hill and top
               gear lets you coast — the difference is audible and useful. */
            if (wheel.powered && this.throttle === 0 && this.shiftTimer <= 0) {
                const dt3 = this.drivetrain;
                const ratio = Math.abs(this.reversing ? dt3.reverse : dt3.gears[this.gear - 1]);
                brakeTorque +=
                    dt3.engineBrake * dt3.peakTorque * ratio * dt3.finalDrive * (this.rpm / dt3.maxRpm);
            }
            /* Rolling resistance as a fraction of the load the tyre carries,
               heavier on sand than tarmac. Faded out at a standstill so it
               cannot masquerade as a parking brake. */
            const crr = surfaceInfo.roll * spec.rollingResistance * 0.00022;
            brakeTorque += crr * normalForce * wheel.radius * clamp(Math.abs(vLong) * 2, 0, 1);

            const drive = wheel.powered ? wheelDrive : 0;
            const resist = brakeTorque * sign(wheel.omega || vLong || 1);
            const netTorque = drive - resist - longForce * wheel.radius;
            const stiffness = (TYRE_STIFFNESS_AT_ZERO * capacity) / peakRatio;
            const implicit = 1 + (dt * stiffness * wheel.radius * wheel.radius) / (wheel.inertia * vRef);
            let deltaOmega = (netTorque * wheel.invInertia * dt) / implicit;

            /* Brakes stop a wheel, they never drive it backwards. */
            const nextOmega = wheel.omega + deltaOmega;
            if (brakeTorque > 0 && drive === 0 && wheel.omega !== 0 && sign(nextOmega) !== sign(wheel.omega)) {
                const rollOmega = vLong / wheel.radius;
                deltaOmega = (Math.abs(rollOmega) < 0.4 ? 0 : nextOmega) - wheel.omega;
            }
            wheel.omega += deltaOmega;
            if (wheel.powered) wheel.omega = clamp(wheel.omega, -omegaCeiling, omegaCeiling);

            wheel.spin += wheel.omega * dt;
            wheel.spinSpeed = wheel.omega;

            const spinExcess = Math.abs(slipRatio);
            if (wheel.powered && spinExcess > worstSpin) worstSpin = spinExcess;

            /* What the effects layer reads: 0 gripping, 1 fully sliding. */
            wheel.skid = clamp(Math.max(s - 0.85, Math.abs(vLat) / 11 - 0.18), 0, 1);

            _v1.copy(_v2).multiplyScalar(longForce).addScaledVector(_v3, latForce);

            /* Apply grip at the roll centre, not at the contact patch.
             *
             * A real suspension does not hand the whole cornering force to the
             * body a metre below its centre of mass — the linkage carries most
             * of it in at axle height. Applied at the contact patch the lever
             * arm is so long that peak grip produces about twenty radians per
             * second squared of roll, and every corner ends with the truck on
             * its side. Only the height is moved; keeping x and z at the
             * contact preserves the yaw moment that actually steers the thing. */
            _rollPoint.set(
                wheel.contact.x,
                wheel.contact.y + (this.position.y - wheel.contact.y) * spec.rollCentre,
                wheel.contact.z
            );
            this.applyForce(_v1, _rollPoint);
        }

        this.groundedCount = grounded;
        this.wheelspin = worstSpin;
        this.engineLoad = clamp(
            (this.rpm - this.drivetrain.idleRpm) / (this.drivetrain.maxRpm - this.drivetrain.idleRpm),
            0,
            1
        );

        /* ---- anti-roll ------------------------------------------------- */
        /* Without this a tall vehicle tips over in any corner worth taking.
           Real cars have a bar between the wheels on each axle doing exactly
           this job. */
        if (spec.antiRoll > 0) {
            for (let axle = 0; axle < this.wheels.length; axle += 2) {
                const a = this.wheels[axle];
                const b = this.wheels[axle + 1];
                if (!a || !b) break;
                const diff = a.compression - b.compression;
                if (diff !== 0 && (a.grounded || b.grounded)) {
                    const force = diff * spec.antiRoll;
                    if (a.grounded) this.applyForce(_v1.copy(up).multiplyScalar(-force), a.contact);
                    if (b.grounded) this.applyForce(_v1.copy(up).multiplyScalar(force), b.contact);
                }
            }
        }

        /* ---- stability control ------------------------------------------
         *
         * A light hand on the yaw rate: if the car is rotating a lot faster
         * than the steering asked for, take a little of it back. Deliberately
         * weak — the point is to keep a slide catchable, not to prevent one.
         * Set `stability: 0` on a spec and it drifts like a shopping trolley,
         * which is precisely what the hovercraft wants. */
        if (spec.stability > 0 && grounded > 1 && planar > 5) {
            const yawRate = this.angularVelocity.dot(up);
            const wanted = (this.forwardSpeed * Math.tan(this.steer)) / this.wheelbase;
            const excess = yawRate - clamp(wanted, -2.6, 2.6);
            const overrun = Math.max(0, Math.abs(excess) - 0.35) * sign(excess);
            if (overrun !== 0) {
                this.torqueAccum.addScaledVector(up, -overrun * spec.stability * this.mass);
            }
        }

        /* ---- water ----------------------------------------------------- */
        const groundY = heightAt(this.position.x, this.position.z);
        this.waterDepth = SEA_LEVEL - Math.max(groundY, this.position.y - spec.size.y * 0.5);
        this.inWater = this.position.y - spec.size.y * 0.4 < SEA_LEVEL;

        if (this.inWater) {
            const submersion = clamp((SEA_LEVEL - (this.position.y - spec.size.y * 0.5)) / spec.size.y, 0, 1);
            /* Buoyancy, and a lot of drag. Driving into the sea should feel
               like a mistake you can recover from, not a death. */
            const lift = submersion * this.mass * GRAVITY * (spec.buoyancy || 0.86);
            this.forceAccum.y += lift;
            this.velocity.multiplyScalar(1 - clamp(submersion * (spec.waterDrag || 2.4) * dt, 0, 0.6));
            this.angularVelocity.multiplyScalar(1 - clamp(submersion * 3 * dt, 0, 0.5));
        }

        /* ---- air ------------------------------------------------------- */
        const dragCoefficient = spec.drag * (this.inWater ? 4 : 1);
        _v1.copy(this.velocity).multiplyScalar(-dragCoefficient * this.speed);
        this.forceAccum.add(_v1);

        /* Downforce keeps it planted at speed and makes fast corners possible. */
        if (grounded > 0 && spec.downforce > 0) {
            this.forceAccum.addScaledVector(up, -spec.downforce * this.speed * this.speed);
        }

        if (grounded === 0) {
            this.airborneFor += dt;
            /* A little authority in the air, so a jump can be landed straight
               instead of watched. */
            const air = spec.airControl || 0;
            if (air > 0) {
                this.torqueAccum.addScaledVector(up, -controls.steer * air * this.mass);
                this.torqueAccum.addScaledVector(right, controls.pitch * air * this.mass * 0.7);
                /* Roll authority too, so a wonky take-off can be corrected. */
                this.torqueAccum.addScaledVector(forward, -controls.steer * air * this.mass * 0.25);
            }
        } else {
            this.airborneFor = 0;
        }

        /* ---- keep it shiny side up -------------------------------------
         *
         * Physically a top-heavy truck taken through a corner at ninety
         * deserves to end up on its roof. This is a programme for five year
         * olds. Two assists: roll rate is damped hard, and any lean past level
         * gets a restoring torque that grows as it goes over. Together they
         * still allow a dramatic lean — you can absolutely get two wheels off
         * the ground — while making a full roll something you have to work at.
         */
        const upright = clamp(up.y, -1, 1);
        if (spec.uprightAssist > 0) {
            const lean = 1 - upright;
            if (lean > 0.004) {
                _v1.crossVectors(up, WORLD_UP);
                const inAir = grounded === 0 ? 0.45 : 1;
                this.torqueAccum.addScaledVector(_v1, spec.uprightAssist * this.mass * lean * inAir);
            }
        }
        if (spec.rollDamping > 0) {
            const rollRate = this.angularVelocity.dot(forward);
            this.angularVelocity.addScaledVector(forward, -rollRate * Math.min(1, spec.rollDamping * dt));
        }

        /* ---- integrate ------------------------------------------------- */
        _v1.copy(this.forceAccum).multiplyScalar(dt / this.mass);
        this.velocity.add(_v1);

        this.applyAngularImpulse(this.torqueAccum, dt, this.angularVelocity);

        /* Damping. Angular damping is deliberately strong: a real car is kept
           straight by tyres we only approximate, and without this it wanders. */
        this.velocity.multiplyScalar(1 - clamp(spec.linearDamping * dt, 0, 0.4));
        this.angularVelocity.multiplyScalar(1 - clamp(spec.angularDamping * dt, 0, 0.5));

        /* Creeping. Below walking pace with nothing asked of it, a car sits
           still; the slip model alone leaves it drifting imperceptibly down
           every camber, which reads as the handbrake being broken. */
        if (grounded > 1 && this.throttle === 0 && planar < 0.9) {
            const settle = Math.min(1, dt * (this.brake > 0 || this.handbrake ? 14 : 5));
            this.velocity.x -= this.velocity.x * settle;
            this.velocity.z -= this.velocity.z * settle;
            this.angularVelocity.multiplyScalar(1 - settle * 0.8);
        }

        this.position.addScaledVector(this.velocity, dt);
        this.odometer += this.speed * dt;

        /* Quaternion integration: dq = 0.5 * omega * q. */
        _q1.set(this.angularVelocity.x, this.angularVelocity.y, this.angularVelocity.z, 0);
        _q1.multiply(this.quaternion);
        this.quaternion.x += _q1.x * 0.5 * dt;
        this.quaternion.y += _q1.y * 0.5 * dt;
        this.quaternion.z += _q1.z * 0.5 * dt;
        this.quaternion.w += _q1.w * 0.5 * dt;
        this.quaternion.normalize();

        this.lateralG = grounded > 0 ? this.angularVelocity.dot(up) * this.forwardSpeed : 0;

        this.resolvePenetration(dt);
        this.keepInsideWorld();
        this.trackUpsideDown(dt);
    }

    /* Chassis hitting the ground.
     *
     * Testing only the centre point is not enough: a fire engine is nearly six
     * metres long, and over any crest the middle clears while both ends are
     * buried. Probing the corners and the two ends instead catches that, and
     * pushing out from the deepest one also rotates the body off the obstacle
     * rather than letting it sit half-submerged. */
    resolvePenetration(dt) {
        const spec = this.spec;
        const halfWidth = spec.size.x * 0.5;
        const halfLength = spec.size.z * 0.5;
        const belly = -spec.chassisClearance;

        let deepest = 0;
        let deepestX = 0;
        let deepestZ = 0;

        for (let i = 0; i < CHASSIS_PROBES.length; i += 1) {
            const probe = CHASSIS_PROBES[i];
            _v2.set(probe[0] * halfWidth, belly, probe[1] * halfLength)
                .applyQuaternion(this.quaternion)
                .add(this.position);
            const penetration = heightAt(_v2.x, _v2.z) - _v2.y;
            if (penetration > deepest) {
                deepest = penetration;
                deepestX = _v2.x;
                deepestZ = _v2.z;
            }
        }

        if (deepest > 0.02) {
            /* Ease out rather than teleport, so a scrape does not pop the
               whole truck into the air. */
            this.position.y += Math.min(deepest, 0.3);

            normalAt(deepestX, deepestZ, _v1);
            const into = this.velocity.dot(_v1);
            if (into < 0) {
                this.lastImpact = -into;
                /* Cancel only the velocity going into the ground. Scaling the
                   whole vector — as this did at first — turns every squat
                   under acceleration into a handbrake: the rear valance
                   touches, ten per cent comes off the speed, and it happens a
                   hundred and twenty times a second. Marshall could not get
                   past 35 km/h. */
                this.velocity.addScaledVector(_v1, -into);
            }
            /* A steady, frame-rate-independent drag while it is dragging. */
            const scrub = clamp(deepest * 2.5, 0, 1) * 1.6 * dt;
            this.velocity.multiplyScalar(1 - scrub);

            /* Level the body back toward the slope, so a nose-dive lifts out
               instead of ploughing. */
            _v3.set(0, 1, 0).applyQuaternion(this.quaternion).cross(_v1);
            this.angularVelocity.addScaledVector(_v3, Math.min(deepest, 0.4) * 7 * dt);
        } else {
            this.lastImpact *= Math.max(0, 1 - dt * 8);
        }
    }

    keepInsideWorld() {
        const limit = WORLD_HALF + 260;
        const d = Math.hypot(this.position.x, this.position.z);
        if (d > limit) {
            const k = limit / d;
            this.position.x *= k;
            this.position.z *= k;
            this.velocity.multiplyScalar(0.4);
        }
    }

    trackUpsideDown(dt) {
        _v1.set(0, 1, 0).applyQuaternion(this.quaternion);
        if (_v1.y < 0.1 && this.speed < 5) this.upsideDownFor += dt;
        else this.upsideDownFor = 0;
    }

    /* Set it back on its wheels where it stands. Nobody's five-year-old wants
       to be stuck on the roof. */
    recover() {
        const yaw = Math.atan2(
            2 * (this.quaternion.w * this.quaternion.y + this.quaternion.x * this.quaternion.z),
            1 - 2 * (this.quaternion.y * this.quaternion.y + this.quaternion.x * this.quaternion.x)
        );
        this.quaternion.setFromAxisAngle(_v1.set(0, 1, 0), yaw);
        this.position.y = heightAt(this.position.x, this.position.z) + this.spec.spawnHeight;
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
        this.wheels.forEach((w) => {
            w.omega = 0;
        });
        this.upsideDownFor = 0;
        this.gear = 1;
    }
}

/* --------------------------------------------------------------- *
 * Helicopter
 *
 * Not a car with a different mesh: collective lifts, cyclic tilts the rotor
 * disc and the machine goes where it is pointed, and the tail rotor yaws it.
 * Tilt it too far and you descend, which is the thing that makes flying one
 * feel like flying one.
 * --------------------------------------------------------------- */

export class Helicopter {
    constructor(spec) {
        this.spec = spec;
        this.mass = spec.mass;
        this.position = new THREE.Vector3();
        this.quaternion = new THREE.Quaternion();
        this.velocity = new THREE.Vector3();
        this.angularVelocity = new THREE.Vector3();
        this.rotorSpin = 0;
        this.rotorSpeed = 0;
        this.collective = 0;
        this.speed = 0;
        this.groundedCount = 0;
        this.airborneFor = 0;
        this.inWater = false;
        this.engineLoad = 0;
        this.upsideDownFor = 0;
        this.lastImpact = 0;
        this.odometer = 0;
        this.wheels = [];
        this.steer = 0;
        this.forwardSpeed = 0;
        this.lateralSpeed = 0;
        this.driftAngle = 0;
        this.wheelspin = 0;
        this.rpm = 0;
        this.gear = 0;
        this.shiftTimer = 0;
        this._up = new THREE.Vector3();
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        /* Gusts, so a hover is a thing you hold rather than a thing you set. */
        this.gustPhase = Math.random() * 100;
    }

    setTransform(x, z, heading) {
        this.position.set(x, heightAt(x, z) + this.spec.spawnHeight, z);
        this.quaternion.setFromAxisAngle(_v1.set(0, 1, 0), heading);
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
    }

    recover() {
        this.quaternion.setFromAxisAngle(_v1.set(0, 1, 0), 0);
        this.position.y = heightAt(this.position.x, this.position.z) + this.spec.spawnHeight;
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
    }

    step(dt, controls) {
        const spec = this.spec;
        const up = this._up.set(0, 1, 0).applyQuaternion(this.quaternion);
        const forward = this._forward.set(0, 0, 1).applyQuaternion(this.quaternion);
        const right = this._right.set(1, 0, 0).applyQuaternion(this.quaternion);

        const ground = heightAt(this.position.x, this.position.z);
        const altitude = this.position.y - ground;
        const landed = altitude < spec.spawnHeight + 0.12 && this.velocity.y <= 0.4;

        /* Rotor spools up before it will lift anything. */
        const wantRotor = controls.throttle > 0 || controls.lift !== 0 || !landed ? 1 : 0.18;
        this.rotorSpeed += (wantRotor * spec.rotorMax - this.rotorSpeed) * Math.min(1, dt * 0.9);
        this.rotorSpin += this.rotorSpeed * dt;
        const authority = clamp(this.rotorSpeed / spec.rotorMax, 0, 1);
        this.engineLoad = authority;
        this.rpm = authority * 4200;

        /* Collective: hold to climb, release to settle. Hovering is the
           default, because a five-year-old cannot hold an altitude trim. */
        const climbInput = controls.lift;
        this.collective += (climbInput - this.collective) * Math.min(1, dt * 4);

        const hoverThrust = this.mass * GRAVITY;
        let thrust = hoverThrust * (1 + this.collective * spec.climbPower) * authority * authority;
        /* Ground effect: a little extra lift when you are nearly down. */
        if (altitude < 6) thrust *= 1 + (1 - altitude / 6) * 0.14;

        this.velocity.addScaledVector(up, (thrust / this.mass) * dt);
        this.velocity.y -= GRAVITY * dt;

        /* A slow wander in the air. Small enough that it never fights you,
           big enough that a hover looks alive rather than parked. */
        if (!landed && authority > 0.5) {
            this.gustPhase += dt;
            const gust = spec.gust ?? 0.55;
            this.velocity.x += Math.sin(this.gustPhase * 0.73) * gust * dt;
            this.velocity.z += Math.cos(this.gustPhase * 0.51) * gust * dt;
        }

        /* Cyclic. Pitch and roll are attitude targets, not torques — a real
           helicopter needs constant correction and this one should not. */
        if (authority > 0.35) {
            const targetPitch = -controls.pitch * spec.maxTilt;
            const targetRoll = -controls.roll * spec.maxTilt;

            _euler.setFromQuaternion(this.quaternion, "YXZ");
            _euler.y += controls.yaw * spec.yawRate * dt;
            _euler.x += (targetPitch - _euler.x) * Math.min(1, dt * spec.tiltResponse);
            _euler.z += (targetRoll - _euler.z) * Math.min(1, dt * spec.tiltResponse);
            this.quaternion.setFromEuler(_euler);
        }

        /* Drag, heavier sideways than forwards. */
        const vLocalF = this.velocity.dot(forward);
        const vLocalR = this.velocity.dot(right);
        const vLocalU = this.velocity.dot(up);
        this.velocity
            .addScaledVector(forward, -vLocalF * spec.dragForward * dt)
            .addScaledVector(right, -vLocalR * spec.dragSide * dt)
            .addScaledVector(up, -vLocalU * spec.dragVertical * dt);

        this.position.addScaledVector(this.velocity, dt);

        /* Ground contact. */
        const minY = ground + spec.spawnHeight;
        if (this.position.y < minY) {
            const impact = -this.velocity.y;
            if (impact > 0) this.lastImpact = impact;
            this.position.y = minY;
            if (this.velocity.y < 0) this.velocity.y = 0;
            this.velocity.x *= 0.82;
            this.velocity.z *= 0.82;
            /* Settle level on the skids. */
            _euler.setFromQuaternion(this.quaternion, "YXZ");
            _euler.x *= 0.86;
            _euler.z *= 0.86;
            this.quaternion.setFromEuler(_euler);
            this.groundedCount = 1;
            this.airborneFor = 0;
        } else {
            this.groundedCount = 0;
            this.airborneFor += dt;
        }

        this.speed = this.velocity.length();
        this.forwardSpeed = vLocalF;
        this.lateralSpeed = vLocalR;
        this.inWater = this.position.y < SEA_LEVEL + 0.5;
        this.odometer += this.speed * dt;

        const limit = WORLD_HALF + 260;
        const d = Math.hypot(this.position.x, this.position.z);
        if (d > limit) {
            const k = limit / d;
            this.position.x *= k;
            this.position.z *= k;
            this.velocity.multiplyScalar(0.5);
        }
        if (this.position.y > spec.ceiling) {
            this.position.y = spec.ceiling;
            if (this.velocity.y > 0) this.velocity.y = 0;
        }
    }
}

export { clamp, tyreCurve, torqueFactor };

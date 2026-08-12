/*
 * Vehicle physics.
 *
 * A proper rigid body — position, orientation, linear and angular velocity —
 * with four raycast wheels hanging off it on spring suspension. Everything the
 * vehicle does comes out of forces applied at the contact patches: it squats
 * under power, leans into corners, unloads the inside wheels, lands nose-first
 * off a jump and can be spun by braking mid-corner. None of that is scripted.
 *
 * The alternative — moving a box along the ground and tilting it to match the
 * slope — is half the code and none of the fun. You can feel the difference
 * within about three seconds of driving.
 *
 * Body axes: +Z forward, +X right, +Y up.
 */

import * as THREE from "three";
import { heightAt, normalAt, surfaceAt, SURFACE_INFO, SEA_LEVEL, WORLD_HALF } from "./world";

export const GRAVITY = 22;
export const FIXED_DT = 1 / 120;

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
 * Vehicle
 * --------------------------------------------------------------- */

export class Vehicle {
    constructor(spec) {
        this.spec = spec;
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

        this.wheels = spec.wheels.map((w) => ({
            local: new THREE.Vector3(w.x, w.y, w.z),
            radius: w.radius,
            steering: !!w.steering,
            powered: !!w.powered,
            handbrake: !!w.handbrake,
            /* runtime */
            compression: 0,
            lastCompression: 0,
            grounded: false,
            spin: 0,
            spinSpeed: 0,
            slip: 0,
            skid: 0,
            surface: 0,
            worldPos: new THREE.Vector3(),
            contact: new THREE.Vector3(),
            contactNormal: new THREE.Vector3(0, 1, 0),
        }));

        this.steer = 0;
        this.steerTarget = 0;
        this.throttle = 0;
        this.brake = 0;
        this.handbrake = 0;
        this.groundedCount = 0;
        this.speed = 0;
        this.forwardSpeed = 0;
        this.engineLoad = 0;
        this.inWater = false;
        this.waterDepth = 0;
        this.upsideDownFor = 0;
        this.airborneFor = 0;
        this.lastImpact = 0;
        this.odometer = 0;

        this.poweredCount = this.wheels.filter((w) => w.powered).length || 1;

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

        /* ---- steering ------------------------------------------------ */
        /* Less lock the faster you go, or the car becomes a spinning top. */
        const speedFactor = 1 - clamp(Math.abs(this.forwardSpeed) / spec.steerFalloff, 0, 0.72);
        this.steerTarget = controls.steer * spec.steerMax * speedFactor;
        const steerRate = spec.steerSpeed * dt;
        this.steer += clamp(this.steerTarget - this.steer, -steerRate, steerRate);

        this.throttle = controls.throttle;
        this.brake = controls.brake;
        this.handbrake = controls.handbrake ? 1 : 0;

        /* ---- gravity -------------------------------------------------- */
        this.forceAccum.y -= this.mass * GRAVITY;

        /* ---- wheels --------------------------------------------------- */
        let grounded = 0;
        const poweredCount = this.poweredCount;

        for (let i = 0; i < this.wheels.length; i += 1) {
            const wheel = this.wheels[i];
            wheel.worldPos.copy(wheel.local).applyQuaternion(this.quaternion).add(this.position);

            const maxReach = spec.suspensionRest + spec.suspensionTravel + wheel.radius;
            _v3.copy(up).negate();
            const hit = castToGround(wheel.worldPos.x, wheel.worldPos.y, wheel.worldPos.z, _v3, maxReach, groundHit);

            const contactDistance = hit.distance;
            const restDistance = spec.suspensionRest + wheel.radius;

            if (!hit.hit || contactDistance > restDistance + spec.suspensionTravel) {
                wheel.grounded = false;
                wheel.compression = Math.max(0, wheel.compression - dt * 6);
                wheel.skid *= 0.9;
                /* Free-spinning wheel slowly matches road speed again. */
                wheel.spinSpeed += (this.forwardSpeed / wheel.radius - wheel.spinSpeed) * Math.min(1, dt * 3);
                wheel.spin += wheel.spinSpeed * dt;
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

            let normalForce = spec.suspensionStiffness * compression + spec.suspensionDamping * compressionVelocity;
            /* Springs push, they never pull the car down onto the road. */
            if (normalForce < 0) normalForce = 0;
            if (normalForce > spec.suspensionMaxForce) normalForce = spec.suspensionMaxForce;

            /* Along the contact normal, but scaled by how square the car is to
               the ground: on a steep bank a wheel should not launch you
               sideways at full spring force. */
            const align = clamp(wheel.contactNormal.dot(up), 0.25, 1);
            _v1.copy(wheel.contactNormal).multiplyScalar(normalForce * align);
            this.applyForce(_v1, wheel.contact);

            /* ---- tyre basis, in the plane of the ground ---- */
            const steerAngle = wheel.steering ? this.steer : 0;
            _v2.copy(forward).applyAxisAngle(up, steerAngle);
            /* Project onto the contact plane and renormalise. */
            _v2.addScaledVector(wheel.contactNormal, -_v2.dot(wheel.contactNormal)).normalize();
            _v3.crossVectors(wheel.contactNormal, _v2).normalize(); /* points left */

            this.worldVelocityAt(wheel.contact, _v1);
            const vLong = _v1.dot(_v2);
            const vLat = _v1.dot(_v3);

            const surfaceInfo = SURFACE_INFO[hit.surface] || SURFACE_INFO[0];
            const mu = spec.grip * surfaceInfo.grip;
            const maxFriction = mu * normalForce;

            /* ---- longitudinal ---- */
            let longForce = 0;
            if (this.throttle !== 0 && wheel.powered) {
                /* Torque falls away as you approach top speed. */
                const speedRatio = clamp(Math.abs(this.forwardSpeed) / spec.maxSpeed, 0, 1);
                const curve = 1 - speedRatio * speedRatio;
                longForce += (this.throttle * spec.engineForce * curve) / poweredCount;
            }
            if (this.brake > 0) {
                const brakeForce = (this.brake * spec.brakeForce) / this.wheels.length;
                longForce -= clamp(vLong * 90, -brakeForce, brakeForce);
            }
            /* Rolling resistance, heavier on sand than tarmac. */
            longForce -= vLong * surfaceInfo.roll * spec.rollingResistance;

            /* ---- lateral ---- */
            /* Force proportional to slip velocity, which is roughly what a tyre
               does, and what lets the back end step out when you ask too much
               of it. The friction circle below is what stops it being
               unbreakable. */
            let latStiffness = spec.lateralGrip * normalForce;
            if (wheel.handbrake && this.handbrake) latStiffness *= 0.2;
            let latForce = -vLat * latStiffness;

            /* ---- friction circle ---- */
            /* A tyre has one budget of grip to spend on turning and driving
               combined. Spend it all cornering and there is none left to
               accelerate with — which is the whole reason drifting works. */
            const total = Math.hypot(longForce, latForce);
            if (total > maxFriction && total > 0) {
                const scale = maxFriction / total;
                longForce *= scale;
                latForce *= scale;
                wheel.slip = clamp((total / maxFriction - 1) * 0.6, 0, 1);
            } else {
                wheel.slip = 0;
            }

            wheel.skid = clamp(Math.max(wheel.slip, Math.abs(vLat) / 14 - 0.15), 0, 1);

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

            /* Wheel spin for the visual, plus wheelspin when overpowered. */
            const rollSpeed = vLong / wheel.radius;
            wheel.spinSpeed = rollSpeed + wheel.slip * Math.sign(this.throttle || 1) * 14;
            wheel.spin += wheel.spinSpeed * dt;
        }

        this.groundedCount = grounded;
        this.engineLoad = clamp(Math.abs(this.forwardSpeed) / spec.maxSpeed, 0, 1);

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
        this.upsideDownFor = 0;
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
        this._up = new THREE.Vector3();
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
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

export { clamp };

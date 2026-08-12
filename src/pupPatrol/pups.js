/*
 * The pups on their own four feet.
 *
 * "Be any of the dogs" should mean more than choosing whose truck you sit in,
 * so you can get out and walk. On foot the physics is much simpler than the
 * vehicles' — a capsule that sticks to the ground and a walk cycle driven off
 * distance travelled rather than time, so the legs stay in step with the
 * ground at any speed and never skate.
 */

import * as THREE from "three";
import { heightAt, normalAt, SEA_LEVEL } from "./world";
import { obstacles } from "./obstacles";

const _normal = new THREE.Vector3();

const FUR = {
    chase: 0xe8d9bd,
    marshall: 0xf5f0e6,
    skye: 0xf6e5c8,
    rubble: 0xd9a441,
    rocky: 0xb9b3a6,
    zuma: 0xd8a86a,
    everest: 0xf2ece2,
};

function mat(color) {
    return new THREE.MeshLambertMaterial({ color });
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
}

/* A whole pup: body, head, four legs on their own pivots, tail, hat. */
export function buildPupMesh(pup) {
    const group = new THREE.Group();
    group.name = `pup-${pup.id}`;

    const fur = mat(FUR[pup.id] || 0xe8d9bd);
    const coat = mat(pup.colour);
    const dark = mat(0x2a2320);
    const trim = mat(pup.trim);

    const root = new THREE.Group();
    root.position.y = 0.62;
    group.add(root);

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.46, 6, 12), fur);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    root.add(body);

    /* Uniform vest, in the pup's colour. */
    const vest = new THREE.Mesh(new THREE.CapsuleGeometry(0.315, 0.3, 6, 12), coat);
    vest.rotation.x = Math.PI / 2;
    vest.position.z = -0.08;
    root.add(vest);
    root.add(box(0.66, 0.16, 0.2, trim, 0, 0.02, -0.08));

    /* Head assembly on its own pivot so it can turn and nod. */
    const head = new THREE.Group();
    head.position.set(0, 0.3, 0.42);
    root.add(head);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 12), fur);
    skull.scale.set(1, 0.95, 1.05);
    skull.castShadow = true;
    head.add(skull);

    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), fur);
    snout.scale.set(0.9, 0.72, 1.3);
    snout.position.set(0, -0.06, 0.24);
    head.add(snout);
    head.add(
        (() => {
            const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), dark);
            nose.position.set(0, -0.03, 0.38);
            return nose;
        })()
    );

    for (const side of [-1, 1]) {
        const ear = box(0.09, 0.22, 0.14, trim, side * 0.22, 0.2, -0.02);
        ear.rotation.z = side * 0.4;
        head.add(ear);

        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), dark);
        eye.position.set(side * 0.11, 0.05, 0.22);
        head.add(eye);
    }

    /* Cap. */
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.13, 14), coat);
    cap.position.y = 0.24;
    head.add(cap);
    head.add(box(0.34, 0.04, 0.18, coat, 0, 0.2, 0.22));

    /* Collar and tag. */
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 16), coat);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0, 0.16, 0.26);
    root.add(collar);
    const tag = box(0.11, 0.11, 0.03, mat(0xffd83d), 0, 0.06, 0.42);
    root.add(tag);

    /* Legs. Each hangs from a pivot at the shoulder so it swings properly. */
    const legs = [];
    const legPositions = [
        [-0.19, 0.46],
        [0.19, 0.46],
        [-0.19, -0.28],
        [0.19, -0.28],
    ];
    legPositions.forEach(([x, z]) => {
        const pivot = new THREE.Group();
        pivot.position.set(x, 0.02, z);
        root.add(pivot);
        const leg = box(0.13, 0.44, 0.13, fur, 0, -0.22, 0);
        pivot.add(leg);
        const paw = box(0.16, 0.1, 0.19, trim, 0, -0.46, 0.02);
        pivot.add(paw);
        legs.push(pivot);
    });

    const tail = new THREE.Group();
    tail.position.set(0, 0.16, -0.42);
    root.add(tail);
    const tailMesh = box(0.11, 0.11, 0.34, fur, 0, 0.06, -0.16);
    tailMesh.rotation.x = -0.6;
    tail.add(tailMesh);

    group.userData = { root, head, legs, tail, body };
    return group;
}

/* ---------------------------------------------------------------- *
 * On-foot controller
 * ---------------------------------------------------------------- */

const WALK_SPEED = 5.4;
const RUN_SPEED = 9.6;
const JUMP_SPEED = 8.4;
const GRAVITY = 22;
const RADIUS = 0.42;

export class PupOnFoot {
    constructor(mesh) {
        this.mesh = mesh;
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.heading = 0;
        this.grounded = true;
        this.speed = 0;
        this.stride = 0;
        this.bark = 0;
        this.scratch = [];
        /* The vehicle code reads these; on foot they are always empty. */
        this.wheels = [];
        this.groundedCount = 1;
        this.airborneFor = 0;
        this.upsideDownFor = 0;
        this.inWater = false;
        this.rotorSpeed = 0;
        this.throttle = 0;
        this.forwardSpeed = 0;
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
    step(dt, controls, cameraYaw) {
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
            this.heading += delta * Math.min(1, dt * 12);

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
        }

        this.velocity.y -= GRAVITY * dt;
        this.position.addScaledVector(this.velocity, dt);

        /* Ground. Steep slopes push you back down rather than letting you
           walk up a cliff face. */
        const groundY = heightAt(this.position.x, this.position.z);
        if (this.position.y <= groundY + 0.02) {
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

    animate(dt) {
        const { root, legs, tail, head } = this.mesh.userData;
        this.mesh.position.copy(this.position);
        this.mesh.rotation.y = this.heading;

        /* Stride is distance-based, so the feet keep up with the ground
           instead of sliding when the speed changes. */
        const phase = this.stride * 2.6;
        const swing = Math.min(1, this.speed / RUN_SPEED) * 0.85;

        legs.forEach((leg, i) => {
            const offset = i === 0 || i === 3 ? 0 : Math.PI;
            leg.rotation.x = Math.sin(phase + offset) * swing;
        });

        /* Body lifts a touch on each stride and leans into a run. */
        root.position.y = 0.62 + Math.abs(Math.sin(phase)) * 0.05 * swing;
        root.rotation.x = -Math.min(0.18, this.speed * 0.016);

        if (!this.grounded) {
            legs.forEach((leg, i) => {
                leg.rotation.x = i < 2 ? -0.7 : 0.5;
            });
        }

        /* A tail that wags faster the happier the pup is about the pace. */
        tail.rotation.y = Math.sin(this.stride * 4 + this.speed * 0.4) * (0.35 + swing * 0.4);
        head.rotation.x = Math.sin(phase * 0.5) * 0.05 * swing;
    }
}

export { FUR };

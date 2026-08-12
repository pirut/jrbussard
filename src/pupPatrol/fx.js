/*
 * Particles and skid marks.
 *
 * One fixed pool of quads shared by dust, spray, smoke and confetti — the
 * pool never grows and never allocates during play, it just recycles whichever
 * particle has been alive longest. Everything is drawn as a single Points
 * cloud with a custom shader, so the whole effects layer is one draw call.
 */

import * as THREE from "three";
import { makePuffTexture } from "./textures";
import { SURFACE_INFO } from "./world";

const MAX_PARTICLES = 900;
const MAX_SKID_SEGMENTS = 620;

const _colour = new THREE.Color();

export class Effects {
    constructor(scene) {
        this.scene = scene;
        this.time = 0;

        /* ---- particles ---- */
        this.count = MAX_PARTICLES;
        this.cursor = 0;
        this.positions = new Float32Array(MAX_PARTICLES * 3);
        this.velocities = new Float32Array(MAX_PARTICLES * 3);
        this.colours = new Float32Array(MAX_PARTICLES * 3);
        this.sizes = new Float32Array(MAX_PARTICLES);
        this.ages = new Float32Array(MAX_PARTICLES);
        this.lives = new Float32Array(MAX_PARTICLES);
        this.drags = new Float32Array(MAX_PARTICLES);
        this.gravities = new Float32Array(MAX_PARTICLES);
        this.alphas = new Float32Array(MAX_PARTICLES);
        /* The opacity a particle was spawned at; `alphas` is that multiplied by
           the fade curve and gets rewritten every frame. */
        this.baseAlphas = new Float32Array(MAX_PARTICLES);

        for (let i = 0; i < MAX_PARTICLES; i += 1) {
            this.lives[i] = 0;
            this.ages[i] = 1;
            /* Park the dead ones far below the world rather than at the origin,
               where they would show up as a permanent puff of dust in the
               middle of Town Square. */
            this.positions[i * 3 + 1] = -9999;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
        geometry.setAttribute("colour", new THREE.BufferAttribute(this.colours, 3));
        geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));
        geometry.setAttribute("alpha", new THREE.BufferAttribute(this.alphas, 1));
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5000);

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: {
                uTexture: { value: makePuffTexture() },
                uScale: { value: 700 },
                /* Particles have to fade into the distance on the same curve
                   as everything else, or a dust cloud two hundred metres away
                   stays crisp against a hazed hillside and reads as a bug. */
                uFogColour: { value: new THREE.Color(0xcfe9ff) },
                uFogNear: { value: 260 },
                uFogFar: { value: 900 },
            },
            vertexShader: /* glsl */ `
                attribute vec3 colour;
                attribute float size;
                attribute float alpha;
                varying vec3 vColour;
                varying float vAlpha;
                varying float vDepth;
                uniform float uScale;
                void main() {
                    vColour = colour;
                    vAlpha = alpha;
                    vec4 view = modelViewMatrix * vec4(position, 1.0);
                    vDepth = -view.z;
                    /* Clamped, or a particle spawned inside the camera fills
                       the screen with one white square for a frame. */
                    gl_PointSize = clamp(size * uScale / max(-view.z, 1.0), 1.0, 220.0);
                    gl_Position = projectionMatrix * view;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D uTexture;
                uniform vec3 uFogColour;
                uniform float uFogNear, uFogFar;
                varying vec3 vColour;
                varying float vAlpha;
                varying float vDepth;
                void main() {
                    vec4 texel = texture2D(uTexture, gl_PointCoord);
                    float a = texel.a * vAlpha;
                    if (a < 0.01) discard;
                    float fog = smoothstep(uFogNear, uFogFar, vDepth);
                    gl_FragColor = vec4(mix(vColour, uFogColour, fog), a * (1.0 - fog * 0.85));
                }
            `,
        });

        this.points = new THREE.Points(geometry, material);
        this.points.frustumCulled = false;
        this.points.renderOrder = 4;
        scene.add(this.points);

        /* ---- skid marks ---- */
        this.skidCursor = 0;
        this.skidPositions = new Float32Array(MAX_SKID_SEGMENTS * 6 * 3);
        this.skidAlphas = new Float32Array(MAX_SKID_SEGMENTS * 6);
        const skidGeometry = new THREE.BufferGeometry();
        skidGeometry.setAttribute("position", new THREE.BufferAttribute(this.skidPositions, 3));
        skidGeometry.setAttribute("alpha", new THREE.BufferAttribute(this.skidAlphas, 1));
        skidGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5000);

        this.skidMesh = new THREE.Mesh(
            skidGeometry,
            new THREE.ShaderMaterial({
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -6,
                polygonOffsetUnits: -6,
                uniforms: { uColour: { value: new THREE.Color(0x241d18) } },
                vertexShader: `
                    attribute float alpha;
                    varying float vAlpha;
                    void main() {
                        vAlpha = alpha;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColour;
                    varying float vAlpha;
                    void main() {
                        if (vAlpha < 0.01) discard;
                        gl_FragColor = vec4(uColour, vAlpha * 0.5);
                    }
                `,
            })
        );
        this.skidMesh.frustumCulled = false;
        this.skidMesh.renderOrder = 1;
        scene.add(this.skidMesh);

        /* Last contact point per wheel, so a skid is a ribbon rather than a
           string of disconnected dashes. */
        this.lastSkid = [];
    }

    spawn(x, y, z, vx, vy, vz, options = {}) {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % MAX_PARTICLES;

        this.positions[i * 3] = x;
        this.positions[i * 3 + 1] = y;
        this.positions[i * 3 + 2] = z;
        this.velocities[i * 3] = vx;
        this.velocities[i * 3 + 1] = vy;
        this.velocities[i * 3 + 2] = vz;

        _colour.set(options.colour ?? 0xffffff);
        this.colours[i * 3] = _colour.r;
        this.colours[i * 3 + 1] = _colour.g;
        this.colours[i * 3 + 2] = _colour.b;

        this.sizes[i] = options.size ?? 1.2;
        this.lives[i] = options.life ?? 1.0;
        this.ages[i] = 0;
        this.drags[i] = options.drag ?? 1.4;
        this.gravities[i] = options.gravity ?? -2.2;
        this.baseAlphas[i] = options.alpha ?? 0.6;
        this.alphas[i] = 0;
        return i;
    }

    /* Dust, spray and smoke thrown up by a wheel. */
    wheelSpray(wheel, vehicleSpeed, random = Math.random) {
        const info = SURFACE_INFO[wheel.surface] || SURFACE_INFO[0];
        const intensity = wheel.skid * info.dustRate;
        if (intensity < 0.06) return;
        if (random() > intensity * 0.85) return;

        const speedFactor = Math.min(1, vehicleSpeed / 18);
        this.spawn(
            wheel.contact.x + (random() - 0.5) * 0.6,
            wheel.contact.y + 0.15,
            wheel.contact.z + (random() - 0.5) * 0.6,
            (random() - 0.5) * 2.4,
            0.7 + random() * 1.9 * speedFactor,
            (random() - 0.5) * 2.4,
            {
                colour: info.dust,
                size: 0.9 + random() * 1.5 + speedFactor,
                life: 0.7 + random() * 0.7,
                alpha: 0.16 + intensity * 0.34,
                gravity: -1.2,
                drag: 1.9,
            }
        );
    }

    waterSpray(x, y, z, speed, random = Math.random) {
        for (let i = 0; i < 2; i += 1) {
            this.spawn(
                x + (random() - 0.5) * 1.6,
                y + 0.2,
                z + (random() - 0.5) * 1.6,
                (random() - 0.5) * 4,
                1.6 + random() * 3.4 * Math.min(1, speed / 14),
                (random() - 0.5) * 4,
                {
                    colour: 0xdff4ff,
                    size: 0.8 + random() * 1.3,
                    life: 0.5 + random() * 0.5,
                    alpha: 0.55,
                    gravity: -9,
                    drag: 1.2,
                }
            );
        }
    }

    /* Marshall's cannon: a cone of water thrown forward. */
    waterJet(origin, direction, random = Math.random) {
        for (let i = 0; i < 3; i += 1) {
            const spread = 0.16;
            this.spawn(
                origin.x,
                origin.y,
                origin.z,
                direction.x * (16 + random() * 8) + (random() - 0.5) * spread * 30,
                direction.y * (16 + random() * 8) + 4 + (random() - 0.5) * spread * 20,
                direction.z * (16 + random() * 8) + (random() - 0.5) * spread * 30,
                {
                    colour: 0xcfeaff,
                    size: 0.7 + random() * 0.8,
                    life: 0.85,
                    alpha: 0.7,
                    gravity: -13,
                    drag: 0.5,
                }
            );
        }
    }

    smoke(x, y, z, amount, random = Math.random) {
        for (let i = 0; i < amount; i += 1) {
            this.spawn(
                x + (random() - 0.5) * 1.2,
                y + random() * 0.8,
                z + (random() - 0.5) * 1.2,
                (random() - 0.5) * 1.6,
                1.4 + random() * 1.6,
                (random() - 0.5) * 1.6,
                {
                    colour: 0x3b3b40,
                    size: 1.4 + random() * 1.8,
                    life: 1.3 + random(),
                    alpha: 0.4,
                    gravity: 1.1,
                    drag: 1.2,
                }
            );
        }
    }

    burst(x, y, z, colour, amount, power = 7, random = Math.random) {
        for (let i = 0; i < amount; i += 1) {
            const a = random() * Math.PI * 2;
            const e = random() * 1.2;
            this.spawn(
                x,
                y,
                z,
                Math.cos(a) * Math.cos(e) * power,
                Math.sin(e) * power + 3,
                Math.sin(a) * Math.cos(e) * power,
                {
                    colour,
                    size: 0.7 + random() * 1.0,
                    life: 1.1 + random() * 0.8,
                    alpha: 0.9,
                    gravity: -9,
                    drag: 0.7,
                }
            );
        }
    }

    /* What comes off a collision: a few bright sparks that die fast, and a
       slower shower of dirt. The sparks are what the eye reads as "that hurt";
       the dirt is what makes the hit feel like it happened to the ground
       rather than to a pair of colliding maths objects. */
    debris(x, y, z, amount, random = Math.random) {
        const sparks = Math.min(10, Math.round(amount * 0.6));
        for (let i = 0; i < sparks; i += 1) {
            const a = random() * Math.PI * 2;
            const e = random() * 0.9;
            const power = 6 + random() * 9;
            this.spawn(
                x + (random() - 0.5) * 0.8,
                y + random() * 0.6,
                z + (random() - 0.5) * 0.8,
                Math.cos(a) * Math.cos(e) * power,
                Math.sin(e) * power + 2,
                Math.sin(a) * Math.cos(e) * power,
                {
                    colour: random() < 0.5 ? 0xffd88a : 0xfff3c8,
                    size: 0.22 + random() * 0.2,
                    life: 0.22 + random() * 0.24,
                    alpha: 1,
                    gravity: -14,
                    drag: 0.5,
                }
            );
        }
        for (let i = 0; i < amount; i += 1) {
            const a = random() * Math.PI * 2;
            const power = 2 + random() * 5;
            this.spawn(
                x + (random() - 0.5) * 1.2,
                y + random() * 0.5,
                z + (random() - 0.5) * 1.2,
                Math.cos(a) * power,
                1.5 + random() * 3.5,
                Math.sin(a) * power,
                {
                    colour: 0xa89a86,
                    size: 0.5 + random() * 0.9,
                    life: 0.6 + random() * 0.6,
                    alpha: 0.5,
                    gravity: -8,
                    drag: 1.4,
                }
            );
        }
    }

    /* Party time. */
    confetti(x, y, z, random = Math.random) {
        const palette = [0xff5c4d, 0xffd23f, 0x4fd6c8, 0x9b6cff, 0x6bd66b, 0xff9ad5];
        for (let i = 0; i < 60; i += 1) {
            const a = random() * Math.PI * 2;
            this.spawn(
                x + (random() - 0.5) * 4,
                y + 4 + random() * 4,
                z + (random() - 0.5) * 4,
                Math.cos(a) * (2 + random() * 6),
                3 + random() * 7,
                Math.sin(a) * (2 + random() * 6),
                {
                    colour: palette[Math.floor(random() * palette.length)],
                    size: 0.5 + random() * 0.6,
                    life: 2.2 + random() * 1.4,
                    alpha: 1,
                    gravity: -6,
                    drag: 0.9,
                }
            );
        }
    }

    addSkid(wheelIndex, x, y, z, width, strength) {
        const previous = this.lastSkid[wheelIndex];
        this.lastSkid[wheelIndex] = { x, y, z, strength };
        if (!previous) return;

        const dx = x - previous.x;
        const dz = z - previous.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.12 || length > 6) return;

        /* Sideways offset for the ribbon. */
        const nx = (-dz / length) * width * 0.5;
        const nz = (dx / length) * width * 0.5;

        const segment = this.skidCursor;
        this.skidCursor = (this.skidCursor + 1) % MAX_SKID_SEGMENTS;
        const base = segment * 18;
        const aBase = segment * 6;

        const p = this.skidPositions;
        const corners = [
            [previous.x + nx, previous.y + 0.05, previous.z + nz],
            [previous.x - nx, previous.y + 0.05, previous.z - nz],
            [x + nx, y + 0.05, z + nz],
            [x - nx, y + 0.05, z - nz],
        ];
        const order = [0, 1, 2, 2, 1, 3];
        for (let i = 0; i < 6; i += 1) {
            const c = corners[order[i]];
            p[base + i * 3] = c[0];
            p[base + i * 3 + 1] = c[1];
            p[base + i * 3 + 2] = c[2];
            this.skidAlphas[aBase + i] = i < 2 ? previous.strength : strength;
        }

        this.skidDirty = true;
    }

    endSkid(wheelIndex) {
        this.lastSkid[wheelIndex] = null;
    }

    update(dt) {
        this.time += dt;
        const positions = this.positions;
        const velocities = this.velocities;

        for (let i = 0; i < MAX_PARTICLES; i += 1) {
            if (this.ages[i] >= this.lives[i]) {
                if (positions[i * 3 + 1] > -9000) {
                    positions[i * 3 + 1] = -9999;
                    this.alphas[i] = 0;
                }
                continue;
            }
            this.ages[i] += dt;

            const drag = 1 - Math.min(0.9, this.drags[i] * dt);
            velocities[i * 3] *= drag;
            velocities[i * 3 + 1] = velocities[i * 3 + 1] * drag + this.gravities[i] * dt;
            velocities[i * 3 + 2] *= drag;

            positions[i * 3] += velocities[i * 3] * dt;
            positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
            positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;

            const t = this.ages[i] / this.lives[i];
            /* Fade in fast, out slow — a puff that pops into existence at full
               opacity looks like a glitch. */
            const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
            this.alphas[i] = Math.max(0, fade) * this.baseAlphas[i];
            this.sizes[i] += dt * 1.2;
        }

        this.points.geometry.attributes.position.needsUpdate = true;
        this.points.geometry.attributes.alpha.needsUpdate = true;
        this.points.geometry.attributes.size.needsUpdate = true;
        this.points.geometry.attributes.colour.needsUpdate = true;

        if (this.skidDirty) {
            this.skidMesh.geometry.attributes.position.needsUpdate = true;
            this.skidMesh.geometry.attributes.alpha.needsUpdate = true;
            this.skidDirty = false;
        }
    }

    reset() {
        for (let i = 0; i < MAX_PARTICLES; i += 1) {
            this.ages[i] = 1;
            this.lives[i] = 0;
            this.alphas[i] = 0;
            this.positions[i * 3 + 1] = -9999;
        }
        this.skidAlphas.fill(0);
        this.lastSkid = [];
        this.skidDirty = true;
    }
}

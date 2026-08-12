/*
 * The picture.
 *
 * Three things separate a WebGL toy from something that looks made: what the
 * surfaces are reflecting, what happens to the image after it is drawn, and
 * where the shadows land. This module owns all three.
 *
 *   1. An environment map, baked once from the same sky the player sees. Every
 *      metal and painted surface in the game reflects it. Without it, a
 *      "metallic" material has nothing to be metallic *about* and reads as
 *      flat grey plastic; with it, chrome looks like chrome and a lacquered
 *      body picks up the sky along its shoulder line.
 *
 *   2. A post chain: bloom, then a single pass that does speed blur, chromatic
 *      aberration, tone mapping, grading, vignette and grain together, then
 *      antialiasing. Doing the grade in one pass rather than five keeps the
 *      whole chain to two full-screen draws.
 *
 *   3. A shadow rig that keeps the sun's frustum wrapped tightly around
 *      wherever the player actually is, and grows it as they speed up. A
 *      fixed frustum big enough for the island would put each shadow texel
 *      about a metre and a half across.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";

/* --------------------------------------------------------------- *
 * Quality tiers
 *
 * One place that decides what a machine gets, so nothing else in the game has
 * to ask "are we on low?" more than once.
 * --------------------------------------------------------------- */

export const QUALITY = {
    low: {
        pixelRatio: 1,
        shadows: false,
        shadowMap: 1024,
        bloom: false,
        smaa: false,
        grade: true,
        anisotropy: 2,
        shadowNear: 90,
        drawDistance: 620,
        cover: { spacing: 2.1, radius: 46 },
        terrainCells: 40,
        seaCells: 90,
        envSize: 128,
    },
    medium: {
        pixelRatio: 1.35,
        shadows: true,
        shadowMap: 2048,
        bloom: true,
        smaa: false,
        grade: true,
        anisotropy: 4,
        shadowNear: 110,
        drawDistance: 900,
        cover: { spacing: 1.55, radius: 64 },
        terrainCells: 52,
        seaCells: 150,
        envSize: 256,
    },
    high: {
        pixelRatio: 2,
        shadows: true,
        shadowMap: 4096,
        bloom: true,
        smaa: true,
        grade: true,
        anisotropy: 8,
        shadowNear: 130,
        drawDistance: 1250,
        cover: { spacing: 1.2, radius: 80 },
        terrainCells: 64,
        seaCells: 220,
        envSize: 256,
    },
};

export function qualityFor(name) {
    return QUALITY[name] || QUALITY.high;
}

/* Guess once, from what the machine tells us about itself. Deliberately
   conservative: a phone that renders at 12 fps is worse than a phone that
   renders a simpler scene at 50. */
export function detectQuality() {
    if (typeof window === "undefined") return "high";
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    const pixels = window.innerWidth * window.innerHeight * Math.min(window.devicePixelRatio || 1, 2);

    if (coarse || cores <= 4 || memory <= 3) return "low";
    if (cores <= 8 || memory <= 6 || pixels > 4.2e6) return "medium";
    return "high";
}

/* --------------------------------------------------------------- *
 * Environment
 * --------------------------------------------------------------- */

const ENV_VERTEX = /* glsl */ `
    varying vec3 vDir;
    void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

/* The reflected world, in the crudest terms that still read correctly: bright
   sky above, warm sun blob, and the island's own green bounced back from
   below. The ground half matters more than it sounds — without it every
   downward-facing curve on a car reflects black and the paint looks dirty. */
const ENV_FRAGMENT = /* glsl */ `
    uniform vec3 uTop, uMid, uHorizon, uGround, uGroundFar, uSunColor, uSunDir;
    varying vec3 vDir;
    void main() {
        vec3 d = normalize(vDir);
        vec3 col;
        if (d.y >= 0.0) {
            col = mix(uHorizon, uMid, smoothstep(0.0, 0.3, d.y));
            col = mix(col, uTop, smoothstep(0.25, 0.9, d.y));
            float sun = max(dot(d, normalize(uSunDir)), 0.0);
            col += uSunColor * pow(sun, 380.0) * 9.0;
            col += uSunColor * pow(sun, 9.0) * 0.22;
        } else {
            col = mix(uHorizon, uGround, smoothstep(0.0, 0.22, -d.y));
            col = mix(col, uGroundFar, smoothstep(0.2, 0.75, -d.y));
        }
        gl_FragColor = vec4(col, 1.0);
    }
`;

export function buildEnvironment(renderer, options = {}) {
    const sunDirection = options.sunDirection || new THREE.Vector3(0.4, 0.75, 0.35).normalize();

    const scene = new THREE.Scene();
    const material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
            uTop: { value: new THREE.Color(0x2c76c8) },
            uMid: { value: new THREE.Color(0x8ccbf7) },
            uHorizon: { value: new THREE.Color(0xdff1ff) },
            uGround: { value: new THREE.Color(0x9fc073) },
            uGroundFar: { value: new THREE.Color(0x5c7c45) },
            uSunColor: { value: new THREE.Color(0xfff3d4) },
            uSunDir: { value: sunDirection.clone() },
        },
        vertexShader: ENV_VERTEX,
        fragmentShader: ENV_FRAGMENT,
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 20), material));

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromScene(scene, 0.02, 0.5, 40);
    pmrem.dispose();

    material.dispose();
    scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
    });

    return target.texture;
}

/* --------------------------------------------------------------- *
 * Grade
 *
 * One pass, in this order, because each step wants the one before it:
 *
 *   radial blur   – still linear HDR, so the streaks carry real highlight
 *                   energy instead of smearing clipped white
 *   aberration    – same, and it must happen before the highlight rolls off
 *   tone map      – HDR down to something a screen can show
 *   grade         – contrast and saturation applied to display values, which
 *                   is the only place those words mean anything
 *   vignette
 *   grain         – last, so it is a uniform film grain and not something the
 *                   tone curve has crushed out of the shadows
 * --------------------------------------------------------------- */

const GradeShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uExposure: { value: 1.05 },
        uSpeedBlur: { value: 0 },
        uAberration: { value: 0.0016 },
        uVignette: { value: 0.34 },
        uSaturation: { value: 1.12 },
        uContrast: { value: 1.06 },
        uLift: { value: new THREE.Vector3(0.006, 0.008, 0.014) },
        uGain: { value: new THREE.Vector3(1.02, 1.0, 0.985) },
        uGrain: { value: 0.028 },
        uFlash: { value: 0 },
        uFlashColour: { value: new THREE.Color(0xffffff) },
        uAspect: { value: 1.777 },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime, uExposure, uSpeedBlur, uAberration, uVignette;
        uniform float uSaturation, uContrast, uGrain, uFlash, uAspect;
        uniform vec3 uLift, uGain, uFlashColour;
        varying vec2 vUv;

        vec3 aces(vec3 x) {
            const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
            return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
            vec2 centred = vUv - 0.5;
            float radius = length(vec2(centred.x * uAspect, centred.y));

            /* Radial blur, weighted so the middle of the screen stays sharp
               and only the edges streak. Six taps is enough at the strength
               speed ever reaches; more just costs fill rate. */
            vec3 colour;
            float blur = uSpeedBlur * smoothstep(0.12, 0.75, radius);
            if (blur > 0.001) {
                vec3 sum = vec3(0.0);
                for (int i = 0; i < 6; i++) {
                    float t = float(i) / 5.0;
                    vec2 uv = vUv - centred * blur * t;
                    sum += texture2D(tDiffuse, uv).rgb;
                }
                colour = sum / 6.0;
            } else {
                colour = texture2D(tDiffuse, vUv).rgb;
            }

            /* Chromatic aberration: the lens does not focus every wavelength
               at the same radius. Scaled by radius so the centre is clean. */
            float ca = uAberration * (radius * radius) * (1.0 + uSpeedBlur * 6.0);
            if (ca > 0.00002) {
                colour.r = texture2D(tDiffuse, vUv - centred * ca).r;
                colour.b = texture2D(tDiffuse, vUv + centred * ca).b;
            }

            colour *= uExposure;
            colour = aces(colour);

            /* Grade, on display values. */
            float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
            colour = mix(vec3(luma), colour, uSaturation);
            colour = (colour - 0.5) * uContrast + 0.5;
            colour = clamp(colour * uGain + uLift, 0.0, 1.0);

            if (uFlash > 0.0) colour = mix(colour, uFlashColour, uFlash);

            /* Vignette: a soft cos^4 falloff, which is what a real lens does
               and reads as depth rather than as a dark ring. */
            float v = cos(clamp(radius * 1.35, 0.0, 1.5));
            colour *= mix(1.0, v * v * v * v, uVignette);

            /* Grain, animated. */
            float g = hash(vUv * 900.0 + fract(uTime) * 91.7) - 0.5;
            colour += g * uGrain * (1.0 - luma * 0.55);
            colour = clamp(colour, 0.0, 1.0);

            /* This pass replaces OutputPass, so the linear-to-sRGB transfer is
               ours to do. Anything after it (antialiasing) wants perceptual
               values anyway, and passes them through untouched. */
            vec3 lo = colour * 12.92;
            vec3 hi = 1.055 * pow(colour, vec3(0.41666)) - 0.055;
            gl_FragColor = vec4(mix(hi, lo, step(colour, vec3(0.0031308))), 1.0);
        }
    `,
};

/* --------------------------------------------------------------- *
 * The chain
 * --------------------------------------------------------------- */

export class PostFX {
    constructor(renderer, scene, camera, quality) {
        this.renderer = renderer;
        this.quality = quality;
        this.enabled = quality.grade || quality.bloom || quality.smaa;
        if (!this.enabled) return;

        /* A half-float working buffer: bloom and the tone curve both need
           values above 1, and an 8-bit chain clips the sun to a flat disc. */
        const target = new THREE.WebGLRenderTarget(1, 1, {
            type: THREE.HalfFloatType,
            colorSpace: THREE.LinearSRGBColorSpace,
            samples: 0,
        });

        this.composer = new EffectComposer(renderer, target);
        this.composer.addPass(new RenderPass(scene, camera));

        if (quality.bloom) {
            /* Kept above a high threshold so it only catches siren domes,
               headlights, chrome and sun on water — enough to make the lights
               feel lit rather than painted, without hazing the whole picture
               into a soft-focus mess. */
            this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.62, 0.85);
            this.composer.addPass(this.bloom);
        }

        this.grade = new ShaderPass(GradeShader);
        this.composer.addPass(this.grade);

        if (quality.smaa) {
            this.smaa = new SMAAPass(1, 1);
            this.composer.addPass(this.smaa);
        }

        this.composer.passes[this.composer.passes.length - 1].renderToScreen = true;
    }

    /* Called once a frame with everything the look reacts to. */
    update(dt, state) {
        if (!this.enabled) return;
        const u = this.grade.uniforms;
        u.uTime.value += dt;

        /* Speed blur ramps in late so ordinary driving is clean and only the
           top of the range feels frantic. */
        const rush = Math.min(1, Math.max(0, (state.speedRatio - 0.45) / 0.55));
        const target = rush * rush * 0.055 + (state.boost || 0) * 0.03;
        u.uSpeedBlur.value += (target - u.uSpeedBlur.value) * Math.min(1, dt * 6);

        /* A frame of white on a hard landing or a heavy hit. */
        if (state.flash) u.uFlash.value = Math.min(0.5, u.uFlash.value + state.flash);
        u.uFlash.value *= Math.max(0, 1 - dt * 5);

        /* Under water the whole picture goes green and loses its contrast. */
        const wet = state.submerged ? 1 : 0;
        u.uSaturation.value += (1.12 - wet * 0.34 - u.uSaturation.value) * Math.min(1, dt * 4);
        u.uContrast.value += (1.06 - wet * 0.14 - u.uContrast.value) * Math.min(1, dt * 4);
    }

    render(scene, camera, dt) {
        if (!this.enabled) {
            this.renderer.render(scene, camera);
            return;
        }
        this.composer.render(dt);
    }

    setSize(width, height) {
        if (!this.enabled) return;
        this.composer.setSize(width, height);
        if (this.bloom) this.bloom.setSize(width, height);
        if (this.smaa) this.smaa.setSize(width, height);
        this.grade.uniforms.uAspect.value = width / Math.max(1, height);
    }

    dispose() {
        if (!this.enabled) return;
        this.composer.renderTarget1.dispose();
        this.composer.renderTarget2.dispose();
        this.composer.passes.forEach((pass) => {
            if (pass.dispose) pass.dispose();
        });
    }
}

/* --------------------------------------------------------------- *
 * Shadows
 *
 * The sun is a directional light, so its shadow camera is an orthographic box
 * that has to contain everything you want shadowed. Sizing that box to the
 * island would spread 4096 texels over 900 metres — a quarter of a metre each,
 * which turns the crisp edge under a truck into a staircase. Instead the box
 * is kept just big enough for what is on screen and pushed *ahead* of the
 * player, so at speed the shadows you are driving into are the sharp ones.
 *
 * Snapping the box centre to whole texels is what stops the whole shadow map
 * shimmering as you move: without it every edge in the world crawls.
 * --------------------------------------------------------------- */

const _shadowFocus = new THREE.Vector3();

export class ShadowRig {
    constructor(sun, quality) {
        this.sun = sun;
        this.quality = quality;
        this.near = quality.shadowNear;
        this.current = quality.shadowNear;
        sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
        sun.shadow.camera.near = 20;
        sun.shadow.camera.far = 900;
        sun.shadow.bias = -0.0006;
        sun.shadow.normalBias = 0.045;
        sun.shadow.blurSamples = 12;
    }

    update(dt, focus, forward, speed, sunDirection) {
        /* Grow the box with speed and push it up the road. */
        const want = this.near * (1 + Math.min(1, speed / 34) * 0.55);
        this.current += (want - this.current) * Math.min(1, dt * 1.5);
        const extent = this.current;

        const lead = Math.min(1, speed / 30) * extent * 0.3;
        _shadowFocus.copy(focus).addScaledVector(forward, lead);

        /* Snap to the shadow map's own texel grid so edges stay put. */
        const texel = (extent * 2) / this.quality.shadowMap;
        _shadowFocus.x = Math.round(_shadowFocus.x / texel) * texel;
        _shadowFocus.z = Math.round(_shadowFocus.z / texel) * texel;

        const camera = this.sun.shadow.camera;
        if (camera.right !== extent) {
            camera.left = -extent;
            camera.right = extent;
            camera.top = extent;
            camera.bottom = -extent;
            camera.updateProjectionMatrix();
        }

        this.sun.position.copy(_shadowFocus).addScaledVector(sunDirection, 320);
        this.sun.target.position.copy(_shadowFocus);
        this.sun.target.updateMatrixWorld();
    }
}

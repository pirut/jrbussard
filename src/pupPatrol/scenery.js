/*
 * Turning the height function into something you can look at: ground, sea,
 * tarmac and sky.
 *
 * The ground is built as a grid of chunks rather than one mesh. Not for
 * memory — it all fits — but because a single 900 m mesh is either always
 * drawn or never drawn, and with the camera at ground level most of the island
 * is behind you. Chunks let the frustum throw away the half you cannot see.
 */

import * as THREE from "three";
import { heightAt, roads, WORLD_HALF, SEA_LEVEL } from "./world";
import { fbm2, clamp, smoothstep } from "./noise";
import { makeGroundGrain, makeRoadTexture, makeWaterNormal, makeCloudTexture } from "./textures";

export const CHUNK_SIZE = 76.7;
export const CHUNKS_PER_SIDE = Math.ceil((WORLD_HALF * 2) / CHUNK_SIZE);
const CELLS_PER_CHUNK = 44; /* ~1.7 m ground resolution */

/* --------------------------------------------------------------- *
 * Ground colour
 *
 * Deliberately saturated. Muted naturalistic greens read as overcast and sad,
 * and this island is not supposed to be either.
 * --------------------------------------------------------------- */

export const PALETTE = {
    sandWet: new THREE.Color(0xd9c48d),
    sandDry: new THREE.Color(0xf2e2b4),
    grassA: new THREE.Color(0x5aad34),
    grassB: new THREE.Color(0x8ed455),
    grassDark: new THREE.Color(0x3f8c2c),
    rock: new THREE.Color(0x8b8378),
    rockDark: new THREE.Color(0x6d675e),
    snow: new THREE.Color(0xf6fbff),
    dirt: new THREE.Color(0x9a7b4f),
};

const tmpColor = new THREE.Color();

function groundColour(x, z, height, slope, out) {
    const variation = fbm2(x * 0.017, z * 0.017, 401, 3);
    const patch = fbm2(x * 0.0052, z * 0.0052, 409, 2);

    /* The sand band is deliberately tight. Flattening the coast to make it
       drivable put a lot of the island under 12 m, and a beach that fades out
       over that range turns two thirds of Adventure Bay into a car park. */
    if (height < 0.4) {
        out.copy(PALETTE.sandWet);
    } else if (height < 2.6) {
        out.copy(PALETTE.sandWet).lerp(PALETTE.sandDry, smoothstep(0.4, 2.6, height));
    } else {
        out.copy(PALETTE.grassA).lerp(PALETTE.grassB, clamp(variation * 0.5 + 0.5 + patch * 0.35, 0, 1));
        const beachy = 1 - smoothstep(2.6, 5.4, height);
        if (beachy > 0) out.lerp(PALETTE.sandDry, beachy * 0.85);
        /* Dry, tired grass on the high pasture. */
        const high = smoothstep(34, 58, height);
        if (high > 0) out.lerp(PALETTE.grassDark, high * 0.5);
    }

    /* Anything steep enough shows its bones. */
    const rocky = smoothstep(0.5, 0.85, slope);
    if (rocky > 0) {
        tmpColor.copy(PALETTE.rock).lerp(PALETTE.rockDark, clamp(variation * 0.5 + 0.5, 0, 1));
        out.lerp(tmpColor, rocky);
    }

    /* Snowline, thinning on the steep faces where it would slide off. */
    const snowy = smoothstep(54, 70, height) * (1 - smoothstep(0.72, 1.15, slope));
    if (snowy > 0) out.lerp(PALETTE.snow, snowy);

    return out;
}

/* --------------------------------------------------------------- *
 * Ground mesh
 * --------------------------------------------------------------- */

function buildChunk(cx, cz, material) {
    const n = CELLS_PER_CHUNK;
    const originX = -WORLD_HALF + cx * CHUNK_SIZE;
    const originZ = -WORLD_HALF + cz * CHUNK_SIZE;
    const step = CHUNK_SIZE / n;
    const verts = (n + 1) * (n + 1);

    const positions = new Float32Array(verts * 3);
    const normals = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    const indices = new Uint32Array(n * n * 6);

    const colour = new THREE.Color();
    let p = 0;
    let underwaterOnly = true;

    for (let j = 0; j <= n; j += 1) {
        for (let i = 0; i <= n; i += 1) {
            const x = originX + i * step;
            const z = originZ + j * step;
            const y = heightAt(x, z);
            if (y > SEA_LEVEL - 3) underwaterOnly = false;

            positions[p * 3] = x;
            positions[p * 3 + 1] = y;
            positions[p * 3 + 2] = z;

            /* Central differences against the same height function the wheels
               use, so lighting and collision never disagree. */
            const hl = heightAt(x - step, z);
            const hr = heightAt(x + step, z);
            const hd = heightAt(x, z - step);
            const hu = heightAt(x, z + step);
            const nx = hl - hr;
            const nz = hd - hu;
            const ny = 2 * step;
            const inv = 1 / Math.hypot(nx, ny, nz);
            normals[p * 3] = nx * inv;
            normals[p * 3 + 1] = ny * inv;
            normals[p * 3 + 2] = nz * inv;

            const slope = Math.hypot(hr - hl, hu - hd) / (2 * step);
            groundColour(x, z, y, slope, colour);
            colors[p * 3] = colour.r;
            colors[p * 3 + 1] = colour.g;
            colors[p * 3 + 2] = colour.b;

            uvs[p * 2] = x * 0.09;
            uvs[p * 2 + 1] = z * 0.09;
            p += 1;
        }
    }

    let t = 0;
    for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
            const a = j * (n + 1) + i;
            const b = a + 1;
            const c = a + n + 1;
            const d = c + 1;
            indices[t] = a;
            indices[t + 1] = c;
            indices[t + 2] = b;
            indices[t + 3] = b;
            indices[t + 4] = c;
            indices[t + 5] = d;
            t += 6;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData.seabed = underwaterOnly;
    return mesh;
}

export function createGroundMaterial() {
    const grain = makeGroundGrain();
    return new THREE.MeshLambertMaterial({
        vertexColors: true,
        map: grain,
    });
}

/* Yields between rows of chunks so the loading bar can actually move. */
export async function buildGround(onProgress, yieldTo) {
    const material = createGroundMaterial();
    const group = new THREE.Group();
    group.name = "ground";
    const total = CHUNKS_PER_SIDE * CHUNKS_PER_SIDE;
    let done = 0;

    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz += 1) {
        for (let cx = 0; cx < CHUNKS_PER_SIDE; cx += 1) {
            group.add(buildChunk(cx, cz, material));
            done += 1;
        }
        if (onProgress) onProgress(done / total);
        if (yieldTo) await yieldTo();
    }

    return group;
}

/* --------------------------------------------------------------- *
 * Sea
 * --------------------------------------------------------------- */

const DEPTH_TEX_SIZE = 384;
const MAX_DEPTH = 42;

function bakeDepthTexture() {
    const size = DEPTH_TEX_SIZE;
    const data = new Uint8Array(size * size);
    for (let j = 0; j < size; j += 1) {
        const z = -WORLD_HALF + ((j + 0.5) / size) * WORLD_HALF * 2;
        for (let i = 0; i < size; i += 1) {
            const x = -WORLD_HALF + ((i + 0.5) / size) * WORLD_HALF * 2;
            const depth = clamp((SEA_LEVEL - heightAt(x, z)) / MAX_DEPTH, 0, 1);
            data[j * size + i] = Math.round(depth * 255);
        }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

export function buildSea() {
    const geo = new THREE.PlaneGeometry(4200, 4200, 1, 1);
    geo.rotateX(-Math.PI / 2);

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
            uDepth: { value: bakeDepthTexture() },
            uRipple: { value: makeWaterNormal() },
            uTime: { value: 0 },
            uShallow: { value: new THREE.Color(0x4fd6c8) },
            uMid: { value: new THREE.Color(0x1f9fd0) },
            uDeep: { value: new THREE.Color(0x11497f) },
            uFoam: { value: new THREE.Color(0xf4ffff) },
            uSky: { value: new THREE.Color(0x9fd8ff) },
            uSun: { value: new THREE.Color(0xfff4d0) },
            uSunDir: { value: new THREE.Vector3(0.4, 0.75, 0.35) },
            uHalf: { value: WORLD_HALF },
            uMaxDepth: { value: MAX_DEPTH },
            uFogColor: { value: new THREE.Color(0xbfe4ff) },
            uFogNear: { value: 260 },
            uFogFar: { value: 900 },
        },
        vertexShader: /* glsl */ `
            varying vec3 vWorld;
            void main() {
                vec4 world = modelMatrix * vec4(position, 1.0);
                vWorld = world.xyz;
                gl_Position = projectionMatrix * viewMatrix * world;
            }
        `,
        fragmentShader: /* glsl */ `
            uniform sampler2D uDepth;
            uniform sampler2D uRipple;
            uniform float uTime;
            uniform vec3 uShallow, uMid, uDeep, uFoam, uSky, uSun, uSunDir, uFogColor;
            uniform float uHalf, uMaxDepth, uFogNear, uFogFar;
            varying vec3 vWorld;

            void main() {
                vec2 uv = (vWorld.xz + uHalf) / (2.0 * uHalf);
                float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
                /* Outside the island's depth map it is simply open ocean. */
                float depth = mix(uMaxDepth, texture2D(uDepth, clamp(uv, 0.0, 1.0)).r * uMaxDepth, inside);

                vec3 col = mix(uShallow, uMid, smoothstep(0.6, 6.0, depth));
                col = mix(col, uDeep, smoothstep(6.0, 22.0, depth));

                vec2 rp = vWorld.xz * 0.035;
                vec3 r1 = texture2D(uRipple, rp + vec2(uTime * 0.016, uTime * 0.011)).rgb * 2.0 - 1.0;
                vec3 r2 = texture2D(uRipple, rp * 2.1 - vec2(uTime * 0.014, uTime * 0.019)).rgb * 2.0 - 1.0;
                vec3 n = normalize(vec3(r1.x + r2.x, 5.0, r1.z + r2.z));

                vec3 viewDir = normalize(cameraPosition - vWorld);
                float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.0);
                col = mix(col, uSky, fres * 0.66);

                float spec = pow(max(dot(reflect(-normalize(uSunDir), n), viewDir), 0.0), 110.0);
                col += uSun * spec * 1.7;

                /* Surf: the waterline wobbles so the foam is not a printed
                   outline of the coast. */
                float wobble = sin(vWorld.x * 0.36 + uTime * 1.4) * 0.16
                             + sin(vWorld.z * 0.41 - uTime * 1.15) * 0.16
                             + sin((vWorld.x + vWorld.z) * 0.13 + uTime * 0.7) * 0.1;
                float foam = smoothstep(0.62 + wobble, 0.04 + wobble, depth);
                col = mix(col, uFoam, foam * 0.9);

                float alpha = mix(0.62, 0.97, smoothstep(0.1, 3.5, depth));
                alpha = max(alpha, foam * 0.95);

                float dist = length(cameraPosition - vWorld);
                col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));

                gl_FragColor = vec4(col, alpha);
            }
        `,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = SEA_LEVEL;
    mesh.renderOrder = 2;
    mesh.name = "sea";
    return mesh;
}

/* --------------------------------------------------------------- *
 * Roads
 * --------------------------------------------------------------- */

export function buildRoadRibbons() {
    const texture = makeRoadTexture();
    const material = new THREE.MeshLambertMaterial({
        map: texture,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
    });

    const group = new THREE.Group();
    group.name = "roads";

    roads.forEach((road) => {
        const { path } = road;
        const half = road.width * 0.5;
        const positions = [];
        const uvs = [];
        const indices = [];
        let travelled = 0;

        for (let i = 0; i < path.length; i += 1) {
            const [x, z] = path[i];
            const prev = path[Math.max(0, i - 1)];
            const next = path[Math.min(path.length - 1, i + 1)];
            let tx = next[0] - prev[0];
            let tz = next[1] - prev[1];
            const tl = Math.hypot(tx, tz) || 1;
            tx /= tl;
            tz /= tl;
            /* Left normal in the ground plane. */
            const nx = -tz;
            const nz = tx;

            if (i > 0) travelled += Math.hypot(x - prev[0], z - prev[1]);

            const lx = x + nx * half;
            const lz = z + nz * half;
            const rx = x - nx * half;
            const rz = z - nz * half;

            /* Sit on the surface the terrain actually ended up with, rather
               than on the centreline height: the flattening pass writes
               through a 3 m grid and the two differ by a few centimetres. */
            positions.push(lx, heightAt(lx, lz) + 0.09, lz);
            positions.push(rx, heightAt(rx, rz) + 0.09, rz);
            const v = travelled / (road.width * 1.6);
            uvs.push(0, v, 1, v);
        }

        for (let i = 0; i < path.length - 1; i += 1) {
            const a = i * 2;
            indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        geo.computeBoundingSphere();

        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
    });

    return group;
}

/* --------------------------------------------------------------- *
 * Sky
 * --------------------------------------------------------------- */

export function buildSky() {
    const group = new THREE.Group();
    group.name = "sky";

    const geo = new THREE.SphereGeometry(1900, 32, 20);
    const material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
            uTop: { value: new THREE.Color(0x2f7fd4) },
            uMid: { value: new THREE.Color(0x8fcbf5) },
            uHorizon: { value: new THREE.Color(0xd6efff) },
            uSunDir: { value: new THREE.Vector3(0.4, 0.75, 0.35).normalize() },
            uSunColor: { value: new THREE.Color(0xfff6da) },
        },
        vertexShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
                vDir = normalize(position);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */ `
            uniform vec3 uTop, uMid, uHorizon, uSunDir, uSunColor;
            varying vec3 vDir;
            void main() {
                float h = clamp(vDir.y, -1.0, 1.0);
                vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.28, h));
                col = mix(col, uTop, smoothstep(0.22, 0.85, h));
                float sun = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
                col += uSunColor * pow(sun, 220.0) * 1.2;
                col += uSunColor * pow(sun, 12.0) * 0.16;
                gl_FragColor = vec4(col, 1.0);
            }
        `,
    });

    const dome = new THREE.Mesh(geo, material);
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    group.add(dome);
    group.userData.dome = dome;

    /* Clouds: camera-facing quads on a slow drift. Cheap, and at this scale
       nobody is going to fly through one and find it flat. */
    const cloudTex = makeCloudTexture();
    const cloudMat = new THREE.SpriteMaterial({
        map: cloudTex,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        fog: false,
    });
    const clouds = new THREE.Group();
    for (let i = 0; i < 26; i += 1) {
        const sprite = new THREE.Sprite(cloudMat);
        const angle = (i / 26) * Math.PI * 2 + Math.random();
        const radius = 620 + Math.random() * 620;
        sprite.position.set(Math.cos(angle) * radius, 210 + Math.random() * 200, Math.sin(angle) * radius);
        const scale = 260 + Math.random() * 280;
        sprite.scale.set(scale, scale * 0.46, 1);
        sprite.userData.drift = 0.5 + Math.random() * 0.9;
        clouds.add(sprite);
    }
    group.add(clouds);
    group.userData.clouds = clouds;

    return group;
}

export const SUN_DIRECTION = new THREE.Vector3(0.4, 0.75, 0.35).normalize();

/* --------------------------------------------------------------- *
 * Lighting
 * --------------------------------------------------------------- */

/*
 * A bright, high-key, midday-in-summer look. The show is lit like a toy advert:
 * strong warm key, a lot of blue skylight bouncing back in, and shadows that
 * are soft and coloured rather than black. Underlighting it is what makes
 * cheerful geometry look grim.
 */
export function buildLighting(scene) {
    const sun = new THREE.DirectionalLight(0xfff1cf, 2.9);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(220);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 620;
    sun.shadow.camera.left = -140;
    sun.shadow.camera.right = 140;
    sun.shadow.camera.top = 140;
    sun.shadow.camera.bottom = -140;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.05;
    scene.add(sun);
    scene.add(sun.target);

    /* Sky above, grass bounce below. */
    const sky = new THREE.HemisphereLight(0xcdeaff, 0x87a85c, 1.55);
    scene.add(sky);

    /* A cool fill from behind separates silhouettes from the background — the
       trick every animated film uses so characters never merge into scenery. */
    const rim = new THREE.DirectionalLight(0xbfe0ff, 0.75);
    rim.position.set(-SUN_DIRECTION.x * 180, 90, -SUN_DIRECTION.z * 180);
    scene.add(rim);

    return { sun, sky, rim };
}

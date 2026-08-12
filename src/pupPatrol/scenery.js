/*
 * Turning the height function into something you can look at: ground, sea,
 * tarmac, sky and the horizon behind all of it.
 *
 * The ground is built as a grid of chunks rather than one mesh. Not for
 * memory — it all fits — but because a single 900 m mesh is either always
 * drawn or never drawn, and with the camera at ground level most of the island
 * is behind you. Chunks let the frustum throw away the half you cannot see.
 */

import * as THREE from "three";
import { heightAt, roads, WORLD_HALF, SEA_LEVEL } from "./world";
import { fbm2, clamp, smoothstep, makeRandom } from "./noise";
import { makeGroundGrain, makeGroundDetail, makeRoadTexture, makeWaterNormal, makeCloudTexture } from "./textures";

export const CHUNK_SIZE = 76.7;
export const CHUNKS_PER_SIDE = Math.ceil((WORLD_HALF * 2) / CHUNK_SIZE);
/* Ground resolution, in cells across one chunk. The island is a hundred and
   forty-four chunks, so this squares straight into the triangle budget: at 64
   the terrain alone is 1.2 million triangles a frame, which a laptop should
   not be asked for. */
const CELLS_PER_CHUNK = { low: 40, medium: 52, high: 64 };

export const SUN_DIRECTION = new THREE.Vector3(0.4, 0.75, 0.35).normalize();

/* One colour, used by the sky's lowest band, by the fog, and by the far edge
   of the sea. They have to agree or the horizon shows a seam. */
export const HORIZON_COLOUR = 0xcfe9ff;

/* --------------------------------------------------------------- *
 * Ground colour
 *
 * Deliberately saturated. Muted naturalistic greens read as overcast and sad,
 * and this island is not supposed to be either.
 * --------------------------------------------------------------- */

export const PALETTE = {
    sandWet: new THREE.Color(0xd0b980),
    sandDry: new THREE.Color(0xf4e4b6),
    grassA: new THREE.Color(0x57ab31),
    grassB: new THREE.Color(0x92d857),
    grassDark: new THREE.Color(0x3c8829),
    rock: new THREE.Color(0x8b8378),
    rockDark: new THREE.Color(0x685f56),
    snow: new THREE.Color(0xf8fcff),
    dirt: new THREE.Color(0x9a7b4f),
};

const tmpColor = new THREE.Color();

function groundColour(x, z, height, slope, out) {
    const variation = fbm2(x * 0.017, z * 0.017, 401, 3);
    const patch = fbm2(x * 0.0052, z * 0.0052, 409, 2);
    /* A third, much broader field so whole hillsides differ from each other —
       the thing that stops the island reading as one repeated texture. */
    const region = fbm2(x * 0.0016, z * 0.0016, 811, 2);
    /* And a fourth, near the limit of what 1.2 m vertices can carry: patches
       of worn and lush grass a few metres across. Four octaves spread across
       three orders of magnitude of scale is what the eye reads as ground
       rather than as paint — one octave at any scale reads as a gradient. */
    const close = fbm2(x * 0.09, z * 0.09, 617, 2);

    /* The sand band is deliberately tight. Flattening the coast to make it
       drivable put a lot of the island under 12 m, and a beach that fades out
       over that range turns two thirds of Adventure Bay into a car park. */
    if (height < 0.4) {
        out.copy(PALETTE.sandWet);
    } else if (height < 2.6) {
        out.copy(PALETTE.sandWet).lerp(PALETTE.sandDry, smoothstep(0.4, 2.6, height));
    } else {
        out.copy(PALETTE.grassA).lerp(PALETTE.grassB, clamp(variation * 0.5 + 0.5 + patch * 0.35 + close * 0.3, 0, 1));
        out.lerp(PALETTE.grassDark, clamp(region * 0.4 + 0.2, 0, 0.42));
        /* Bare, trodden ground where the noise fields happen to agree. */
        const worn = clamp((close * 0.6 + patch * 0.4) * 1.4 - 0.5, 0, 0.34);
        if (worn > 0) out.lerp(PALETTE.dirt, worn);
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

function buildChunk(cx, cz, material, n) {
    const originX = -WORLD_HALF + cx * CHUNK_SIZE;
    const originZ = -WORLD_HALF + cz * CHUNK_SIZE;
    const step = CHUNK_SIZE / n;
    const verts = (n + 1) * (n + 1);

    const positions = new Float32Array(verts * 3);
    const normals = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    /* How wet this bit of ground is. Drives roughness, so the strip the tide
       reaches is glossy and throws a highlight back at you — which is most of
       what makes a shoreline read as a shoreline. */
    const wet = new Float32Array(verts);
    const indices = new Uint32Array(n * n * 6);

    const colour = new THREE.Color();
    let p = 0;
    let underwaterOnly = true;

    /*
     * Sample the height field once per point, into a grid with a one-cell
     * border, and read the neighbours back out of it.
     *
     * The obvious version asks heightAt for the vertex and then again for each
     * of its four neighbours, to get the normal by central differences — five
     * calls per vertex, and every neighbour is another vertex's centre, so
     * four fifths of the work is repeated. Over a hundred and forty-four
     * chunks that is three million evaluations of a four-octave noise field
     * plus a road lookup, and it was most of the loading screen.
     */
    const span = n + 3;
    const field = new Float32Array(span * span);
    for (let j = -1; j <= n + 1; j += 1) {
        const z = originZ + j * step;
        for (let i = -1; i <= n + 1; i += 1) {
            field[(j + 1) * span + (i + 1)] = heightAt(originX + i * step, z);
        }
    }
    const sample = (i, j) => field[(j + 1) * span + (i + 1)];

    for (let j = 0; j <= n; j += 1) {
        for (let i = 0; i <= n; i += 1) {
            const x = originX + i * step;
            const z = originZ + j * step;
            const y = sample(i, j);
            if (y > SEA_LEVEL - 3) underwaterOnly = false;

            positions[p * 3] = x;
            positions[p * 3 + 1] = y;
            positions[p * 3 + 2] = z;

            /* Central differences against the same height function the wheels
               use, so lighting and collision never disagree. */
            const hl = sample(i - 1, j);
            const hr = sample(i + 1, j);
            const hd = sample(i, j - 1);
            const hu = sample(i, j + 1);
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

            wet[p] = 1 - smoothstep(-0.4, 1.6, y);

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
    geo.setAttribute("wet", new THREE.BufferAttribute(wet, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    /* Deliberately does not cast. Letting the heightfield shadow itself sounds
       like an obvious win — hillsides shading the valleys below them — and in
       practice a surface this large, lit at a grazing angle, acnes into a
       dithered mess that no bias setting fixes without lifting every contact
       shadow off the ground. The terrain's own normals carry the form. */
    mesh.matrixAutoUpdate = false;
    mesh.userData.seabed = underwaterOnly;
    return mesh;
}

/*
 * The ground material.
 *
 * Two noise layers at very different scales, blended by distance. The coarse
 * one covers the island so hillsides read as ground from a kilometre away; the
 * fine one only appears within about eighty metres, which is the range at
 * which a smooth painted plane starts to look like a smooth painted plane.
 * Fading the fine layer out with distance is not an optimisation — leaving it
 * on everywhere just produces shimmering noise at the horizon.
 */
export function createGroundMaterial(quality) {
    const grain = makeGroundGrain();
    const detail = makeGroundDetail();
    grain.anisotropy = quality ? quality.anisotropy : 4;
    detail.anisotropy = quality ? quality.anisotropy : 4;

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: grain,
        roughness: 0.95,
        metalness: 0,
        envMapIntensity: 0.42,
    });

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uDetail = { value: detail };
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nattribute float wet;\nvarying float vWet;")
            .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWet = wet;");
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nuniform sampler2D uDetail;\nvarying float vWet;")
            .replace(
                "#include <map_fragment>",
                `#include <map_fragment>
                 {
                   float _d = length(vViewPosition);
                   float _near = 1.0 - smoothstep(14.0, 95.0, _d);
                   float _mid = 1.0 - smoothstep(60.0, 320.0, _d);
                   float _fine = texture2D(uDetail, vMapUv * 3.0).g;
                   float _coarse = texture2D(uDetail, vMapUv * 0.5).g;
                   diffuseColor.rgb *= mix(1.0, 0.62 + _fine * 0.76, _near * 0.85);
                   diffuseColor.rgb *= mix(1.0, 0.78 + _coarse * 0.44, _mid * 0.6);
                   /* Wet sand is darker as well as shinier. */
                   diffuseColor.rgb *= mix(1.0, 0.74, vWet);
                 }`
            )
            .replace(
                "#include <normal_fragment_begin>",
                `#include <normal_fragment_begin>
                 {
                   /* Bump the shading normal from the same noise the albedo
                      uses, so the ground has actual relief close up instead of
                      a picture of relief. Faded out by distance, because at
                      range the perturbation is smaller than a pixel and all it
                      does is sparkle. */
                   float _d = length(vViewPosition);
                   float _near = 1.0 - smoothstep(8.0, 55.0, _d);
                   if (_near > 0.01) {
                     vec2 _uv = vMapUv * 3.0;
                     float _h = texture2D(uDetail, _uv).g;
                     float _hx = texture2D(uDetail, _uv + vec2(0.006, 0.0)).g;
                     float _hz = texture2D(uDetail, _uv + vec2(0.0, 0.006)).g;
                     vec3 _bump = vec3((_h - _hx) * 5.0, 0.0, (_h - _hz) * 5.0) * _near;
                     normal = normalize(normal + mat3(viewMatrix) * _bump);
                   }
                 }`
            )
            .replace(
                "#include <roughnessmap_fragment>",
                `#include <roughnessmap_fragment>
                 roughnessFactor = mix(roughnessFactor, 0.12, vWet);`
            );
    };
    material.customProgramCacheKey = () => "bay-ground";

    return material;
}

/* Yields between rows of chunks so the loading bar can actually move. */
export async function buildGround(onProgress, yieldTo, quality) {
    const material = createGroundMaterial(quality);
    const cells = (quality && quality.terrainCells) || CELLS_PER_CHUNK.high;
    const group = new THREE.Group();
    group.name = "ground";
    const total = CHUNKS_PER_SIDE * CHUNKS_PER_SIDE;
    let done = 0;

    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz += 1) {
        for (let cx = 0; cx < CHUNKS_PER_SIDE; cx += 1) {
            group.add(buildChunk(cx, cz, material, cells));
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

const DEPTH_TEX_SIZE = 512;
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

export function buildSea(quality) {
    /* Subdivided rather than a single quad: the vertex shader lifts it into
       real swell, and two triangles have nowhere to put that. Denser toward
       the middle would be better still, but at this size uniform is honest
       and costs nothing measurable. */
    const seaCells = (quality && quality.seaCells) || 220;
    const geo = new THREE.PlaneGeometry(11000, 11000, seaCells, seaCells);
    geo.rotateX(-Math.PI / 2);

    const ripple = makeWaterNormal();
    ripple.anisotropy = quality ? quality.anisotropy : 4;

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
            uDepth: { value: bakeDepthTexture() },
            uRipple: { value: ripple },
            uTime: { value: 0 },
            uShallow: { value: new THREE.Color(0x58e0cf) },
            uMid: { value: new THREE.Color(0x1c9ed2) },
            uDeep: { value: new THREE.Color(0x0d3f75) },
            uFoam: { value: new THREE.Color(0xf6ffff) },
            uSky: { value: new THREE.Color(0xa8ddff) },
            uSun: { value: new THREE.Color(0xfff4d0) },
            uSunDir: { value: SUN_DIRECTION.clone() },
            uHalf: { value: WORLD_HALF },
            uMaxDepth: { value: MAX_DEPTH },
            uFogColor: { value: new THREE.Color(HORIZON_COLOUR) },
            uFogNear: { value: 320 },
            uFogFar: { value: 1600 },
            uSwell: { value: 1 },
        },
        vertexShader: /* glsl */ `
            uniform float uTime;
            uniform float uSwell;
            uniform float uHalf;
            uniform sampler2D uDepth;
            uniform float uMaxDepth;
            varying vec3 vWorld;
            varying float vSwell;

            void main() {
                vec4 world = modelMatrix * vec4(position, 1.0);

                /* Swell, damped to nothing as the water shallows out — a wave
                   that keeps its full amplitude right up the beach makes the
                   sand flicker in and out of the sea. */
                vec2 uv = (world.xz + uHalf) / (2.0 * uHalf);
                float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
                float depth = mix(uMaxDepth, texture2D(uDepth, clamp(uv, 0.0, 1.0)).r * uMaxDepth, inside);
                float openness = smoothstep(0.4, 7.0, depth);

                float h = sin(world.x * 0.020 + uTime * 0.72) * 0.42
                        + sin(world.z * 0.026 - uTime * 0.58) * 0.34
                        + sin((world.x + world.z) * 0.011 + uTime * 0.4) * 0.5;
                h *= uSwell * openness;
                world.y += h;

                vSwell = h;
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
            varying float vSwell;

            void main() {
                vec2 uv = (vWorld.xz + uHalf) / (2.0 * uHalf);
                float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
                /* Outside the island's depth map it is simply open ocean. */
                float depth = mix(uMaxDepth, texture2D(uDepth, clamp(uv, 0.0, 1.0)).r * uMaxDepth, inside);

                vec3 col = mix(uShallow, uMid, smoothstep(0.6, 6.0, depth));
                col = mix(col, uDeep, smoothstep(6.0, 22.0, depth));

                float dist = length(cameraPosition - vWorld);
                /* Detail dies away with distance or it turns into a field of
                   aliased sparkle at the horizon. */
                float detail = 1.0 - smoothstep(120.0, 900.0, dist);

                vec2 rp = vWorld.xz * 0.035;
                vec3 r1 = texture2D(uRipple, rp + vec2(uTime * 0.016, uTime * 0.011)).rgb * 2.0 - 1.0;
                vec3 r2 = texture2D(uRipple, rp * 2.3 - vec2(uTime * 0.014, uTime * 0.019)).rgb * 2.0 - 1.0;
                vec3 r3 = texture2D(uRipple, rp * 0.42 + vec2(uTime * 0.006, -uTime * 0.005)).rgb * 2.0 - 1.0;
                vec3 n = normalize(vec3(
                    (r1.x + r2.x * 0.7) * detail + r3.x * 0.8,
                    5.0,
                    (r1.z + r2.z * 0.7) * detail + r3.z * 0.8
                ));

                vec3 viewDir = normalize(cameraPosition - vWorld);
                float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 3.4);
                col = mix(col, uSky, fres * 0.72);

                /* Two speculars: a tight one for the sun itself, and a broad
                   one that becomes the glitter path across the bay. */
                vec3 halfway = normalize(normalize(uSunDir) + viewDir);
                float ndh = max(dot(n, halfway), 0.0);
                col += uSun * pow(ndh, 420.0) * 4.0;
                col += uSun * pow(ndh, 34.0) * 0.28 * detail;

                /* Surf: the waterline wobbles so the foam is not a printed
                   outline of the coast, and the swell throws a crest of its
                   own where the wave is highest. */
                float wobble = sin(vWorld.x * 0.36 + uTime * 1.4) * 0.16
                             + sin(vWorld.z * 0.41 - uTime * 1.15) * 0.16
                             + sin((vWorld.x + vWorld.z) * 0.13 + uTime * 0.7) * 0.1;
                float foam = smoothstep(0.78 + wobble, 0.02 + wobble, depth);
                foam = max(foam, smoothstep(0.55, 1.0, vSwell) * smoothstep(9.0, 1.2, depth) * 0.7);
                col = mix(col, uFoam, foam * 0.92);

                float alpha = mix(0.6, 0.97, smoothstep(0.1, 3.5, depth));
                alpha = max(alpha, foam * 0.95);

                col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist));

                gl_FragColor = vec4(col, alpha);
            }
        `,
    });

    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = SEA_LEVEL;
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    mesh.name = "sea";
    return mesh;
}

/* --------------------------------------------------------------- *
 * Roads
 * --------------------------------------------------------------- */

export function buildRoadRibbons(quality) {
    const texture = makeRoadTexture();
    texture.anisotropy = quality ? quality.anisotropy * 2 : 8;
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.72,
        metalness: 0,
        envMapIntensity: 0.5,
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
        const normals = [];
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
            /* Flat up-normals rather than computed ones. A ribbon two vertices
               wide has terrible normals when you derive them from the
               triangles, and every seam between segments shows as a band. */
            normals.push(0, 1, 0, 0, 1, 0);
            const v = travelled / (road.width * 1.6);
            uvs.push(0, v, 1, v);
        }

        for (let i = 0; i < path.length - 1; i += 1) {
            const a = i * 2;
            indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
        geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);
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

    const geo = new THREE.SphereGeometry(6200, 40, 24);
    const material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
            uTop: { value: new THREE.Color(0x2467c4) },
            uMid: { value: new THREE.Color(0x86c8f6) },
            uHorizon: { value: new THREE.Color(HORIZON_COLOUR) },
            uSunDir: { value: SUN_DIRECTION.clone() },
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
                vec3 d = normalize(vDir);
                float h = clamp(d.y, -1.0, 1.0);

                /* Three bands rather than two: the extra one is the pale
                   ring just above the horizon that every clear day has and
                   whose absence is what makes a gradient sky look like a
                   gradient. */
                vec3 col = mix(uHorizon, uMid, smoothstep(-0.03, 0.26, h));
                col = mix(col, uTop, smoothstep(0.2, 0.92, h));

                float sun = max(dot(d, normalize(uSunDir)), 0.0);
                /* Disc, limb and the wide glow that surrounds it. */
                col += uSunColor * smoothstep(0.9994, 0.9997, sun) * 8.0;
                col += uSunColor * pow(sun, 340.0) * 1.6;
                col += uSunColor * pow(sun, 8.0) * 0.2;
                /* Warmth pooling toward the horizon under the sun. */
                col += uSunColor * pow(sun, 2.0) * (1.0 - smoothstep(0.0, 0.4, h)) * 0.14;

                /* Below the waterline the dome should already be sea colour so
                   nothing shows through at the far edge of the ocean. */
                col = mix(col, uHorizon * 0.86, smoothstep(-0.01, -0.12, h));

                gl_FragColor = vec4(col, 1.0);
            }
        `,
    });

    const dome = new THREE.Mesh(geo, material);
    dome.renderOrder = -2;
    dome.frustumCulled = false;
    group.add(dome);
    group.userData.dome = dome;

    /* Clouds: camera-facing quads on a slow drift, in two layers so the sky
       has depth. Cheap, and at this scale nobody is going to fly through one
       and find it flat. */
    const cloudTex = makeCloudTexture();
    const clouds = new THREE.Group();
    const layers = [
        { count: 22, radius: [700, 1500], height: [230, 400], scale: [300, 520], opacity: 0.95, speed: 1 },
        { count: 14, radius: [1800, 3000], height: [420, 700], scale: [700, 1100], opacity: 0.6, speed: 0.45 },
    ];
    layers.forEach((layer) => {
        const material2 = new THREE.SpriteMaterial({
            map: cloudTex,
            transparent: true,
            opacity: layer.opacity,
            depthWrite: false,
            fog: false,
        });
        for (let i = 0; i < layer.count; i += 1) {
            const sprite = new THREE.Sprite(material2);
            const angle = (i / layer.count) * Math.PI * 2 + Math.random();
            const radius = layer.radius[0] + Math.random() * (layer.radius[1] - layer.radius[0]);
            sprite.position.set(
                Math.cos(angle) * radius,
                layer.height[0] + Math.random() * (layer.height[1] - layer.height[0]),
                Math.sin(angle) * radius
            );
            const scale = layer.scale[0] + Math.random() * (layer.scale[1] - layer.scale[0]);
            sprite.scale.set(scale, scale * 0.42, 1);
            sprite.userData.drift = (0.5 + Math.random() * 0.9) * layer.speed;
            sprite.userData.span = radius * 1.6;
            clouds.add(sprite);
        }
    });
    group.add(clouds);
    group.userData.clouds = clouds;

    return group;
}

/* --------------------------------------------------------------- *
 * The horizon
 *
 * A ring of far-off headlands and mountains, out past the sea. They are not
 * places — you can never reach them — and that is the point: the island reads
 * as one island in an archipelago rather than as a diorama on a table, and
 * the mountain behind town suddenly has something to be measured against.
 *
 * Drawn without fog and pre-hazed in their own vertex colours, because the
 * scene fog is tuned for things a few hundred metres away and these are three
 * kilometres out.
 * --------------------------------------------------------------- */

export function buildDistantLands() {
    const random = makeRandom(51224);
    const group = new THREE.Group();
    group.name = "horizon";

    const positions = [];
    const colors = [];

    const near = new THREE.Color(0x6f93ab);
    const far = new THREE.Color(HORIZON_COLOUR);
    const colour = new THREE.Color();

    /* Each landmass is a fan of ridge points around a centre — a silhouette
       rather than a solid, since nothing will ever get behind one. */
    const islands = 26;
    for (let i = 0; i < islands; i += 1) {
        const angle = (i / islands) * Math.PI * 2 + (random() - 0.5) * 0.16;
        const distance = 2100 + random() * 1900;
        /* A gap in the ring on the bearing the bay faces, so the open sea
           actually looks open from the harbour. */
        const bayward = Math.cos(angle - 1.16);
        if (bayward > 0.86 && random() < 0.75) continue;

        const cx = Math.cos(angle) * distance;
        const cz = Math.sin(angle) * distance;
        const width = 420 + random() * 900;
        const height = 90 + random() * 340 * (1 - Math.min(1, distance / 4200));

        const steps = 16;
        const ridge = [];
        for (let s = 0; s <= steps; s += 1) {
            const t = s / steps;
            const lateral = (t - 0.5) * width;
            /* A humped profile with a couple of subsidiary peaks. */
            const profile =
                Math.pow(Math.sin(t * Math.PI), 0.7) *
                (0.72 + 0.28 * Math.sin(t * Math.PI * (3 + Math.floor(random() * 3))));
            ridge.push({ lateral, y: profile * height });
        }

        const sin = Math.sin(angle + Math.PI / 2);
        const cos = Math.cos(angle + Math.PI / 2);
        const haze = clamp((distance - 1900) / 2400, 0, 1);

        for (let s = 0; s < steps; s += 1) {
            const a = ridge[s];
            const b = ridge[s + 1];
            const ax = cx + cos * a.lateral;
            const az = cz + sin * a.lateral;
            const bx = cx + cos * b.lateral;
            const bz = cz + sin * b.lateral;

            /* Two triangles: sea level up to the ridge line. */
            positions.push(ax, -20, az, bx, -20, bz, ax, a.y, az);
            positions.push(bx, -20, bz, bx, b.y, bz, ax, a.y, az);

            const shade = (y) => {
                colour.copy(near).lerp(far, clamp(haze + 0.42 - y / (height + 60) - 0.1, 0, 1));
                colors.push(colour.r, colour.g, colour.b);
            };
            shade(0);
            shade(0);
            shade(a.y);
            shade(0);
            shade(b.y);
            shade(a.y);
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide })
    );
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    group.add(mesh);

    return group;
}

/* --------------------------------------------------------------- *
 * Lighting
 * --------------------------------------------------------------- */

/*
 * A bright, high-key, midday-in-summer look. The show is lit like a toy advert:
 * strong warm key, a lot of blue skylight bouncing back in, and shadows that
 * are soft and coloured rather than black. Underlighting it is what makes
 * cheerful geometry look grim.
 *
 * With an environment map now supplying ambient reflection, the hemisphere
 * light is pulled back — otherwise the two stack and everything washes out.
 */
export function buildLighting(scene, quality) {
    const sun = new THREE.DirectionalLight(0xfff0ca, 3.1);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(320);
    sun.castShadow = !!(quality && quality.shadows);
    scene.add(sun);
    scene.add(sun.target);

    /* Sky above, grass bounce below. */
    const sky = new THREE.HemisphereLight(0xcdeaff, 0x87a85c, 0.85);
    scene.add(sky);

    /* A cool fill from behind separates silhouettes from the background — the
       trick every animated film uses so characters never merge into scenery. */
    const rim = new THREE.DirectionalLight(0xbfe0ff, 0.7);
    rim.position.set(-SUN_DIRECTION.x * 180, 90, -SUN_DIRECTION.z * 180);
    scene.add(rim);

    return { sun, sky, rim };
}

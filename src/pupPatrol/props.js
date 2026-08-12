/*
 * Trees, rocks and bushes — everything the scatter pass in world.js decided
 * should grow somewhere. Grass is elsewhere: it needs a density static
 * scattering cannot reach, and lives in groundcover.js.
 *
 * All of it is instanced. Ten thousand individual meshes would be ten thousand
 * draw calls and a slideshow; ten thousand instances of nine meshes is nine
 * draw calls. The cost is that every tree of a given kind is the same tree, so
 * the variation has to come from what *can* vary per instance: scale, rotation,
 * lean — and, since this pass, colour. A forest where every crown is the exact
 * same green is the single most obvious tell that something was generated, and
 * a per-instance tint costs one extra attribute to fix.
 */

import * as THREE from "three";
import { scatterProps } from "./world";
import { obstacles } from "./obstacles";

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _colour = new THREE.Color();

/* Foliage leans on a shared clock. Patched into the standard material
   rather than written from scratch so they keep shadows and fog. */
const windUniform = { value: 0 };
const gustUniform = { value: 0 };

/*
 * Wind.
 *
 * Two components, because one is not enough to look like weather: a steady
 * sway everything shares, and a gust that travels across the island as a wave
 * so a whole hillside bends a moment before the next one does. Phase comes
 * from world position, so neighbouring trees agree and distant ones do not.
 */
function addWind(material, strength, anchor = 0) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uWind = windUniform;
        shader.uniforms.uGust = gustUniform;
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                `#include <common>
                 uniform float uWind;
                 uniform float uGust;`
            )
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
                 {
                   vec4 wp = instanceMatrix * vec4(transformed, 1.0);
                   float sway = (wp.y - ${anchor.toFixed(2)}) * ${strength.toFixed(3)};
                   if (sway > 0.0) {
                     float phase = uWind + wp.x * 0.16 + wp.z * 0.13;
                     float gust = 0.55 + 0.45 * sin(uGust - wp.x * 0.011 - wp.z * 0.008);
                     sway *= gust;
                     transformed.x += sin(phase) * sway;
                     transformed.z += cos(phase * 0.83) * sway * 0.6;
                     transformed.y -= abs(sin(phase)) * sway * 0.22;
                   }
                 }`
            );
    };
    /* Distinct key or three.js reuses a cached program without the patch. */
    material.customProgramCacheKey = () => `wind-${strength}-${anchor}`;
    return material;
}

export function tickWind(time) {
    windUniform.value = time * 1.5;
    gustUniform.value = time * 0.55;
}

function standard(color, opts = {}) {
    return new THREE.MeshLambertMaterial({ color, ...opts });
}

/* A blobby low-poly ball: an icosahedron with its vertices knocked about, so
   foliage and rocks read as organic instead of geometric. */
function lumpy(radius, detail, jitter, seed = 1) {
    const geo = new THREE.IcosahedronGeometry(radius, detail);
    const pos = geo.attributes.position;
    let s = seed;
    const rand = () => {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
    for (let i = 0; i < pos.count; i += 1) {
        const k = 1 + (rand() - 0.5) * jitter;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    return geo;
}

function makeInstanced(geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
}

function place(mesh, index, item, yOffset, scaleMul, lean = 0) {
    _position.set(item.x, item.y + yOffset * item.scale * scaleMul, item.z);
    _euler.set(lean ? Math.sin(index * 12.9898) * lean : 0, item.rot, lean ? Math.cos(index * 78.233) * lean : 0);
    _quaternion.setFromEuler(_euler);
    _scale.setScalar(item.scale * scaleMul);
    _matrix.compose(_position, _quaternion, _scale);
    mesh.setMatrixAt(index, _matrix);
}

/* Deterministic per-instance jitter, from the index alone. */
function hash(index, salt) {
    const v = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return v - Math.floor(v);
}

/* Tint an instance.
 *
 * `instanceColor` multiplies the material's own colour, so what goes in here
 * is a factor around 1 rather than a colour. Writing the intended colour in
 * directly — the obvious mistake, and the one made first — squares it, and a
 * forest of mid-greens comes out very nearly black.
 *
 * The variation is one factor for value and a small opposing tilt between red
 * and blue for warmth, which reads as some trees catching more sun than
 * others. Enough to break up a canopy, not enough to look like a fruit salad. */
function tint(mesh, index, warmth, valueSpread, salt) {
    const value = 1 + (hash(index, salt) - 0.5) * valueSpread;
    const warm = (hash(index, salt + 7) - 0.5) * warmth;
    _colour.setRGB(
        clampUnit(value * (1 + warm)),
        clampUnit(value * (1 + warm * 0.15)),
        clampUnit(value * (1 - warm * 0.8))
    );
    mesh.setColorAt(index, _colour);
}

const clampUnit = (v) => (v < 0 ? 0 : v > 1.6 ? 1.6 : v);

export function buildProps() {
    const scatter = scatterProps();
    const group = new THREE.Group();
    group.name = "props";

    /* ---- broadleaf trees ---- */
    if (scatter.trees.length) {
        const n = scatter.trees.length;
        const trunkGeo = new THREE.CylinderGeometry(0.26, 0.44, 4.2, 7);
        trunkGeo.translate(0, 2.1, 0);
        const trunks = makeInstanced(trunkGeo, standard(0x6b4a2b), n);

        /* Three overlapping crowns rather than two, the upper ones lighter, so
           the canopy has a sunlit top and a shaded underside instead of
           reading as one flat green lump. */
        const crownGeo = lumpy(2.5, 1, 0.3, 7);
        crownGeo.translate(0, 5.4, 0);
        const crowns = makeInstanced(crownGeo, addWind(standard(0x4e9e2f), 0.02, 3.5), n);

        const crownGeo2 = lumpy(1.8, 1, 0.34, 19);
        crownGeo2.translate(0.8, 6.5, 0.4);
        const crowns2 = makeInstanced(crownGeo2, addWind(standard(0x86d451), 0.02, 3.5), n);

        const crownGeo3 = lumpy(1.5, 1, 0.4, 23);
        crownGeo3.translate(-0.9, 5.9, -0.5);
        const crowns3 = makeInstanced(crownGeo3, addWind(standard(0x6dbc3f), 0.024, 3.5), n);

        scatter.trees.forEach((item, i) => {
            place(trunks, i, item, 0, 1, 0.05);
            place(crowns, i, item, 0, 1, 0.05);
            place(crowns2, i, item, 0, 1, 0.05);
            place(crowns3, i, item, 0, 1, 0.05);
            tint(trunks, i, 0.1, 0.22, 1);
            tint(crowns, i, 0.16, 0.3, 3);
            tint(crowns2, i, 0.16, 0.3, 5);
            tint(crowns3, i, 0.16, 0.3, 9);
        });
        group.add(trunks, crowns, crowns2, crowns3);
    }

    /* ---- pines ---- */
    if (scatter.pines.length) {
        const n = scatter.pines.length;
        const trunkGeo = new THREE.CylinderGeometry(0.2, 0.36, 5.0, 6);
        trunkGeo.translate(0, 2.5, 0);
        const trunks = makeInstanced(trunkGeo, standard(0x5c4126), n);

        /* Four stacked skirts read as a conifer far more cheaply than a
           single tall cone does. */
        const parts = [
            { r: 2.5, h: 3.0, y: 1.9 },
            { r: 2.0, h: 2.8, y: 3.5 },
            { r: 1.5, h: 2.5, y: 5.0 },
            { r: 0.9, h: 2.2, y: 6.4 },
        ].map((s) => {
            const cone = new THREE.ConeGeometry(s.r, s.h, 9);
            cone.translate(0, s.y + s.h * 0.5 - 0.6, 0);
            return cone;
        });
        const needles = makeInstanced(mergeGeometries(parts), addWind(standard(0x2f7a3c), 0.012, 3.0), n);

        scatter.pines.forEach((item, i) => {
            place(trunks, i, item, 0, 1, 0.03);
            place(needles, i, item, 0, 1, 0.03);
            tint(trunks, i, 0.1, 0.2, 2);
            tint(needles, i, 0.14, 0.34, 4);
        });
        group.add(trunks, needles);
    }

    /* ---- palms ---- */
    if (scatter.palms.length) {
        const n = scatter.palms.length;
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0.3, 2.2, 0.1),
            new THREE.Vector3(0.9, 4.4, 0.3),
            new THREE.Vector3(1.6, 6.0, 0.4),
        ]);
        const trunkGeo = new THREE.TubeGeometry(curve, 10, 0.26, 7, false);
        const trunks = makeInstanced(trunkGeo, standard(0x8a6a3f), n);

        const frondParts = [];
        for (let i = 0; i < 9; i += 1) {
            const frond = new THREE.ConeGeometry(0.42, 3.4, 4, 1, true);
            frond.translate(0, 1.7, 0);
            frond.rotateX(Math.PI * (0.38 + (i % 2) * 0.08));
            frond.rotateY((i / 9) * Math.PI * 2);
            frond.translate(1.6, 6.0, 0.4);
            frondParts.push(frond);
        }
        const fronds = makeInstanced(mergeGeometries(frondParts), addWind(standard(0x3f9a44), 0.03, 5.0), n);

        scatter.palms.forEach((item, i) => {
            place(trunks, i, item, 0, 1);
            place(fronds, i, item, 0, 1);
            tint(trunks, i, 0.1, 0.2, 6);
            tint(fronds, i, 0.14, 0.28, 8);
        });
        group.add(trunks, fronds);
    }

    /* ---- rocks ---- */
    if (scatter.rocks.length) {
        const n = scatter.rocks.length;
        const geo = lumpy(1.15, 0, 0.62, 41);
        geo.scale(1, 0.72, 1);
        geo.translate(0, 0.42, 0);
        const rocks = makeInstanced(geo, standard(0x8b8378), n);
        scatter.rocks.forEach((item, i) => {
            place(rocks, i, item, 0, 1, 0.22);
            tint(rocks, i, 0.12, 0.36, 11);
        });
        group.add(rocks);
    }

    /* ---- bushes ---- */
    if (scatter.bushes.length) {
        const n = scatter.bushes.length;
        const geo = lumpy(1.05, 0, 0.5, 61);
        geo.scale(1.25, 0.8, 1.25);
        geo.translate(0, 0.7, 0);
        const bushes = makeInstanced(geo, addWind(standard(0x568f34), 0.03, 0.2), n);
        scatter.bushes.forEach((item, i) => {
            place(bushes, i, item, 0, 1);
            tint(bushes, i, 0.18, 0.32, 15);
        });
        group.add(bushes);
    }

    /* Trunks and boulders are solid; bushes and grass are not, because being
       stopped dead by a shrub is infuriating and being stopped by a tree is
       fair. Trees give a little, so clipping one costs you the corner rather
       than the whole run. */
    obstacles.addFromScatter(scatter.trees, 0.72, { kind: "tree", restitution: 0.18, absorb: 0.6 });
    obstacles.addFromScatter(scatter.pines, 0.6, { kind: "tree", restitution: 0.18, absorb: 0.6 });
    obstacles.addFromScatter(scatter.palms, 0.45, { kind: "tree", restitution: 0.15, absorb: 0.55 });
    obstacles.addFromScatter(scatter.rocks, 1.05, { kind: "rock", restitution: 0.34, absorb: 0.45 });

    /* Instanced colour is uploaded lazily; flag it explicitly rather than
       relying on the first-frame upload happening to catch it. */
    group.traverse((object) => {
        if (object.isInstancedMesh && object.instanceColor) object.instanceColor.needsUpdate = true;
    });

    group.userData.counts = {
        trees: scatter.trees.length,
        pines: scatter.pines.length,
        palms: scatter.palms.length,
        rocks: scatter.rocks.length,
        bushes: scatter.bushes.length,
    };

    return group;
}

/* three/examples has a merge helper, but pulling in the addons build for one
   function is not worth it — this only ever handles non-indexed or uniformly
   indexed geometries built a few lines above. */
function mergeGeometries(geometries) {
    const merged = new THREE.BufferGeometry();
    const attributeNames = ["position", "normal", "uv"];
    const arrays = {};
    let vertexCount = 0;
    let indexCount = 0;

    geometries.forEach((geo) => {
        vertexCount += geo.attributes.position.count;
        indexCount += geo.index ? geo.index.count : geo.attributes.position.count;
    });

    attributeNames.forEach((name) => {
        const first = geometries[0].attributes[name];
        if (!first) return;
        arrays[name] = { data: new Float32Array(vertexCount * first.itemSize), itemSize: first.itemSize, offset: 0 };
    });
    const indices = new Uint32Array(indexCount);

    let vertexOffset = 0;
    let indexOffset = 0;

    geometries.forEach((geo) => {
        attributeNames.forEach((name) => {
            const attr = geo.attributes[name];
            const target = arrays[name];
            if (!attr || !target) return;
            target.data.set(attr.array, target.offset);
            target.offset += attr.array.length;
        });

        const count = geo.attributes.position.count;
        if (geo.index) {
            for (let i = 0; i < geo.index.count; i += 1) indices[indexOffset + i] = geo.index.array[i] + vertexOffset;
            indexOffset += geo.index.count;
        } else {
            for (let i = 0; i < count; i += 1) indices[indexOffset + i] = i + vertexOffset;
            indexOffset += count;
        }
        vertexOffset += count;
    });

    Object.entries(arrays).forEach(([name, target]) => {
        merged.setAttribute(name, new THREE.BufferAttribute(target.data, target.itemSize));
    });
    merged.setIndex(new THREE.BufferAttribute(indices, 1));
    merged.computeBoundingSphere();
    return merged;
}

export { mergeGeometries };

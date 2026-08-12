/*
 * Grass.
 *
 * Scattering tufts across the whole island and drawing whatever happens to be
 * near you does not work, and the arithmetic says why: convincing ground cover
 * needs roughly one tuft per square metre, and this island is 850,000 square
 * metres. A static scatter dense enough to look right up close is most of a
 * million instances; a static scatter cheap enough to draw is one tuft every
 * six metres, which from a camera two metres off the ground looks like a
 * mown lawn with weeds in it.
 *
 * So the field moves with you. A fixed grid of cells is held around the
 * camera, and as you drive out of one side of it the column you left wraps
 * round to the far side and is re-sampled against the terrain there. The
 * instance count never changes, the draw call never changes, and the grass is
 * always at full density exactly where you can see it.
 *
 * The wrap is a ring buffer in both axes: cell gx lives in slot gx mod N
 * forever, so moving the field by one cell dirties exactly one column and
 * every other instance keeps the matrix it already had. At sixty miles an
 * hour that is about twenty columns a second — two thousand transforms, next
 * to nothing — instead of rebuilding sixteen thousand every frame.
 */

import * as THREE from "three";
import { heightAt, roadInfluenceAt, SEA_LEVEL } from "./world";
import { makeGrassTuft } from "./textures";
import { mergeGeometries } from "./props";

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _colour = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const windUniform = { value: 0 };
const gustUniform = { value: 0 };

/* Deterministic per-cell noise, so a patch of grass looks the same every time
   you drive past it rather than reshuffling behind your back. */
function hash2(x, z, salt) {
    const v = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
    return v - Math.floor(v);
}

function mod(value, n) {
    return ((value % n) + n) % n;
}

function buildTuftGeometry() {
    const quads = [];
    for (let i = 0; i < 3; i += 1) {
        const plane = new THREE.PlaneGeometry(1.5, 0.44);
        plane.translate(0, 0.21, 0);
        plane.rotateY((i * Math.PI) / 3);
        quads.push(plane);
    }
    return mergeGeometries(quads);
}

function buildMaterial(range) {
    const material = new THREE.MeshLambertMaterial({
        map: makeGrassTuft(),
        alphaTest: 0.4,
        side: THREE.DoubleSide,
    });

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uWind = windUniform;
        shader.uniforms.uGust = gustUniform;
        shader.uniforms.uRange = { value: range };
        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                `#include <common>
                 uniform float uWind;
                 uniform float uGust;
                 uniform float uRange;`
            )
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
                 {
                   vec3 anchor = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
                   /* Shrink to nothing over the last quarter of the range. The
                      field's edge is a hard circle; without this you would
                      watch a wall of grass materialise ahead of you. */
                   float fade = 1.0 - smoothstep(uRange * 0.76, uRange, distance(cameraPosition, anchor));
                   transformed *= fade;

                   float sway = max(transformed.y, 0.0) * 0.16;
                   float phase = uWind * 1.6 + anchor.x * 0.42 + anchor.z * 0.36;
                   float gust = 0.45 + 0.55 * sin(uGust - anchor.x * 0.012 - anchor.z * 0.009);
                   transformed.x += sin(phase) * sway * gust;
                   transformed.z += cos(phase * 0.79) * sway * 0.6 * gust;
                 }`
            );
    };
    material.customProgramCacheKey = () => "bay-groundcover";
    return material;
}

export class GroundCover {
    constructor(scene, config) {
        this.spacing = config.spacing;
        this.range = config.radius;
        /* Even, so the field is symmetric about the camera. */
        this.cells = Math.max(4, Math.round((config.radius * 2) / config.spacing / 2) * 2);
        this.count = this.cells * this.cells;

        this.mesh = new THREE.InstancedMesh(buildTuftGeometry(), buildMaterial(config.radius), this.count);
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.name = "groundcover";
        scene.add(this.mesh);

        /* Allocate the colour attribute up front; it never changes after the
           first fill, since tint is a function of the cell and not of time. */
        this.mesh.setColorAt(0, _colour.setRGB(1, 1, 1));

        this.originX = null;
        this.originZ = null;
        this.dirty = false;
    }

    /* The cell index range currently held is [centre - cells/2, centre + cells/2). */
    cellFor(slot, centre) {
        const low = centre - this.cells / 2;
        return low + mod(slot - low, this.cells);
    }

    writeCell(slotX, slotZ, gx, gz) {
        const index = slotZ * this.cells + slotX;
        const S = this.spacing;

        const jx = hash2(gx, gz, 1);
        const jz = hash2(gx, gz, 2);
        const x = (gx + jx) * S;
        const z = (gz + jz) * S;

        const y = heightAt(x, z);
        /* Nothing grows in the sea, on the tarmac, on bare rock or above the
           snowline. Two extra height samples give the slope for a fraction of
           what a full gradient costs. */
        let keep = y > SEA_LEVEL + 1.9 && y < 58;
        if (keep) {
            const slope = Math.hypot(heightAt(x + 1, z) - y, heightAt(x, z + 1) - y);
            /* The influence field is the terrain-flattening skirt and reaches
               far wider than the tarmac; testing it loosely leaves a nine-metre
               bald verge down both sides of every road. This threshold puts the
               grass line about three metres off the white line. */
            keep = slope < 0.62 && roadInfluenceAt(x, z) < 0.86;
        }

        if (!keep) {
            this.mesh.setMatrixAt(index, ZERO);
            return;
        }

        const scale = 0.72 + hash2(gx, gz, 3) * 0.62;
        _position.set(x, y - 0.05, z);
        _euler.set(0, hash2(gx, gz, 4) * Math.PI * 2, 0);
        _quaternion.setFromEuler(_euler);
        _scale.set(scale, scale * (0.75 + hash2(gx, gz, 5) * 0.75), scale);
        _matrix.compose(_position, _quaternion, _scale);
        this.mesh.setMatrixAt(index, _matrix);

        /* Colour: mostly value drift, with the occasional patch of something
           flowering. Cheap, and it stops a hillside reading as one texture. */
        const value = 0.74 + hash2(gx, gz, 6) * 0.5;
        const bloom = hash2(gx, gz, 7);
        if (bloom > 0.972) _colour.setRGB(value * 1.5, value * 1.05, value * 0.8);
        else if (bloom < 0.03) _colour.setRGB(value * 1.35, value * 1.3, value * 0.6);
        else _colour.setRGB(value, value * (0.94 + hash2(gx, gz, 8) * 0.2), value * 0.9);
        this.mesh.setColorAt(index, _colour);
    }

    rebuild(centreX, centreZ) {
        for (let sz = 0; sz < this.cells; sz += 1) {
            const gz = this.cellFor(sz, centreZ);
            for (let sx = 0; sx < this.cells; sx += 1) {
                this.writeCell(sx, sz, this.cellFor(sx, centreX), gz);
            }
        }
        this.originX = centreX;
        this.originZ = centreZ;
        this.dirty = true;
    }

    refreshColumn(slotX, centreX, centreZ) {
        const gx = this.cellFor(slotX, centreX);
        for (let sz = 0; sz < this.cells; sz += 1) {
            this.writeCell(slotX, sz, gx, this.cellFor(sz, centreZ));
        }
    }

    refreshRow(slotZ, centreX, centreZ) {
        const gz = this.cellFor(slotZ, centreZ);
        for (let sx = 0; sx < this.cells; sx += 1) {
            this.writeCell(sx, slotZ, this.cellFor(sx, centreX), gz);
        }
    }

    update(x, z) {
        const centreX = Math.floor(x / this.spacing);
        const centreZ = Math.floor(z / this.spacing);

        if (this.originX === null) {
            this.rebuild(centreX, centreZ);
            return;
        }

        const dx = centreX - this.originX;
        const dz = centreZ - this.originZ;
        if (dx === 0 && dz === 0) return;

        /* A jump bigger than the field itself — a respawn, a pup swap across
           the island — has nothing worth keeping. */
        if (Math.abs(dx) >= this.cells || Math.abs(dz) >= this.cells) {
            this.rebuild(centreX, centreZ);
            return;
        }

        /* One column per cell of travel: the strip that just left the back of
           the field becomes the strip arriving at the front. */
        const step = dx > 0 ? 1 : -1;
        for (let i = 0; i !== dx; i += step) {
            const arriving = step > 0 ? this.originX + i + this.cells / 2 : this.originX + i - 1 - this.cells / 2;
            this.refreshColumn(mod(arriving, this.cells), centreX, this.originZ);
        }
        this.originX = centreX;

        const stepZ = dz > 0 ? 1 : -1;
        for (let i = 0; i !== dz; i += stepZ) {
            const arriving = stepZ > 0 ? this.originZ + i + this.cells / 2 : this.originZ + i - 1 - this.cells / 2;
            this.refreshRow(mod(arriving, this.cells), centreX, centreZ);
        }
        this.originZ = centreZ;

        this.dirty = true;
    }

    /* Called once a frame after update(), so a run of column refreshes costs
       one upload rather than one per column. */
    flush(time) {
        windUniform.value = time * 1.5;
        gustUniform.value = time * 0.55;
        if (!this.dirty) return;
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        this.dirty = false;
    }
}

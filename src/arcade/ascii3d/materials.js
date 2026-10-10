import * as THREE from "three";
import { glyphCode, GLYPH_SETS } from "./asciiPass";

/*
 * Every material in the field writes its glyph set into alpha (see
 * asciiPass.js). That only survives if blending is off — with normal blending
 * three.js forces opaque surfaces to alpha 1 — so all of them are made here.
 */

const cache = new Map();

/*
 * The cutaway. Anything overhead that comes between the camera and you (a
 * bridge, a jutting storey, a line of washing) is carved away along the line
 * of sight, so walking under things never fills the view with the underside
 * of a bridge. A scene sets the two ends of the line and turns it on; people
 * are never cut.
 */
export const cutaway = {
    uCutFrom: { value: new THREE.Vector3() },
    uCutTo: { value: new THREE.Vector3() },
    uCutRadius: { value: 1.1 },
    uCutOn: { value: 0 },
};

function withCutaway(mat) {
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, cutaway);
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vCutWorld;")
            .replace(
                "#include <project_vertex>",
                `#include <project_vertex>
                vec4 cutWorld = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                    cutWorld = instanceMatrix * cutWorld;
                #endif
                vCutWorld = (modelMatrix * cutWorld).xyz;`
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                `#include <common>
                varying vec3 vCutWorld;
                uniform vec3 uCutFrom;
                uniform vec3 uCutTo;
                uniform float uCutRadius;
                uniform float uCutOn;`
            )
            .replace(
                "void main() {",
                `void main() {
                if (uCutOn > 0.5 && vCutWorld.y > uCutTo.y + 0.25) {
                    vec3 line = uCutTo - uCutFrom;
                    float t = clamp(dot(vCutWorld - uCutFrom, line) / dot(line, line), 0.0, 1.0);
                    /* A cone, wide at your end, so the whole of you shows. */
                    if (t < 0.97 && length(vCutWorld - (uCutFrom + line * t)) < uCutRadius * (0.35 + 0.65 * t)) discard;
                }`
            );
    };
    mat.customProgramCacheKey = () => "cutaway";
    return mat;
}

export function material(color, set = "solid", options = {}) {
    const { emissive = null, unlit = false, vertexColors = false, side } = options;
    const key = `${color}|${set}|${emissive}|${unlit}|${vertexColors}|${side}`;
    if (cache.has(key)) return cache.get(key);
    const common = {
        color: vertexColors ? 0xffffff : color,
        vertexColors,
        blending: THREE.NoBlending,
        transparent: false,
        opacity: glyphCode(GLYPH_SETS[set] ?? 0),
        side: side ?? THREE.FrontSide,
    };
    const made = unlit
        ? new THREE.MeshBasicMaterial(common)
        : new THREE.MeshLambertMaterial({
              ...common,
              flatShading: true,
              /* Models glow faintly from within, so a figure in its own
                 shadow still reads as a figure rather than a dark hole. */
              emissive: emissive ?? (vertexColors ? 0x000000 : new THREE.Color(color).multiplyScalar(0.22)),
          });
    if (set !== "figure") withCutaway(made);
    cache.set(key, made);
    return made;
}

/* A material that is never shared, for things that animate their colour. */
export function ownMaterial(color, set = "solid", options = {}) {
    const { emissive = 0x000000, unlit = false } = options;
    const common = {
        color,
        blending: THREE.NoBlending,
        transparent: false,
        opacity: glyphCode(GLYPH_SETS[set] ?? 0),
    };
    const made = unlit
        ? new THREE.MeshBasicMaterial(common)
        : new THREE.MeshLambertMaterial({ ...common, flatShading: true, emissive });
    return set === "figure" ? made : withCutaway(made);
}

/*
 * Every plain part of a person or creature moves to the figure set, which the
 * ASCII pass draws brighter and rings with empty space. Parts that already
 * chose a set (a glowing eye, a timber spear) keep it.
 */
const figures = new Map();
export function asFigure(mat) {
    if (mat.opacity !== glyphCode(GLYPH_SETS.solid)) return mat;
    if (!figures.has(mat.uuid)) {
        const made = mat.clone();
        made.opacity = glyphCode(GLYPH_SETS.figure);
        /* People are never cut away. */
        made.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
        made.customProgramCacheKey = THREE.Material.prototype.customProgramCacheKey;
        /* Rounded figures shade smoothly, into ramps rather than facets. */
        made.flatShading = false;
        figures.set(mat.uuid, made);
    }
    return figures.get(mat.uuid);
}

/* What a figure turns into for the instant it is hit: solid white. */
let flashMaterial = null;
export function hitFlash() {
    if (!flashMaterial) {
        flashMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            blending: THREE.NoBlending,
            transparent: false,
            opacity: glyphCode(GLYPH_SETS.figure),
        });
    }
    return flashMaterial;
}

export function disposeMaterials() {
    cache.forEach((m) => m.dispose());
    cache.clear();
    figures.forEach((m) => m.dispose());
    figures.clear();
    if (flashMaterial) flashMaterial.dispose();
    flashMaterial = null;
}

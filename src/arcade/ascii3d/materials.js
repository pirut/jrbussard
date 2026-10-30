import * as THREE from "three";
import { glyphCode, GLYPH_SETS } from "./asciiPass";
import { cutaway } from "./iso";

/*
 * Every material in the field writes its glyph set into alpha (see
 * asciiPass.js). That only survives if blending is off — with normal blending
 * three.js forces opaque surfaces to alpha 1 — so all of them are made here.
 *
 * `opacity` is therefore not opacity at all on these materials: it carries
 * glyphCode(GLYPH_SETS[set]), the code asciiPass.js decodes from the alpha
 * channel to pick the character set for that surface. Do not set opacity,
 * transparent or blending on anything made here.
 *
 * Ownership: material(), figureMaterial(), asFigure() and hitFlash() hand
 * out shared instances that no model may dispose; the whole lot is freed by
 * the last scene to let go (retainMaterials, below). ownMaterial() is the
 * exception: the caller owns what it returns and must dispose it.
 *
 * Callers: models.js, terrainMesh.js, ghost.js, AsciiWorld.js (hold
 * management), site3d/*.
 */

/* Shared materials by "color|set|emissive|unlit|vertexColors|side". */
const cache = new Map();

/* The shared material for a flat-coloured part. `color` is a CSS colour,
   `set` a key of GLYPH_SETS (asciiPass.js). Options: `emissive` overrides
   the default glow; `unlit` makes a MeshBasicMaterial (ignores lights, used
   for glowing things); `vertexColors` takes colour from the
   geometry instead (the stated `color` is then ignored); `side` defaults to
   front faces. Returns the same object for the same arguments, so never
   mutate it. */
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
    /* Anything of the world can be cut away in front of you; figures are
       copies made below, which leave it out. */
    cutaway(made);
    cache.set(key, made);
    return made;
}

/* A material that is never shared, for things that animate their colour.
   Same arguments as material() minus vertexColors and side, but the default
   emissive is black rather than the shared materials' 22% self-glow, and
   nothing is cached. The caller must dispose it. It is not flagged
   userData.own: callers whose models go through disposeModel (models.js
   flame()) set that flag themselves, and mergeModel skips only flagged
   materials. */
export function ownMaterial(color, set = "solid", options = {}) {
    const { emissive = 0x000000, unlit = false } = options;
    const common = {
        color,
        blending: THREE.NoBlending,
        transparent: false,
        opacity: glyphCode(GLYPH_SETS[set] ?? 0),
    };
    return cutaway(
        unlit
            ? new THREE.MeshBasicMaterial(common)
            : new THREE.MeshLambertMaterial({ ...common, flatShading: true, emissive }),
    );
}

/*
 * The material for a person's or creature's merged parts (figureGeometry.js):
 * colour from the vertices, and the same faint glow from within that
 * material() gives every plain model, so a figure in its own shadow still
 * reads as a figure. Plain parts draw in the figure set; parts that chose a
 * set keep it. Kept in the shared cache, so disposeMaterials() frees it.
 *
 * The 0.22 below is the same factor material() uses for its emissive glow,
 * but applied per vertex colour in the fragment shader (it replaces three's
 * emissivemap chunk with itself plus the extra term) since there is no
 * single `color` to derive an emissive from. The fixed customProgramCacheKey
 * lets every figure share one compiled program.
 */
export function figureMaterial(set = "solid", unlit = false) {
    const key = `figure|${set}|${unlit ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key);
    const common = {
        vertexColors: true,
        blending: THREE.NoBlending,
        transparent: false,
        opacity: glyphCode(GLYPH_SETS[set === "solid" ? "figure" : set] ?? 0),
    };
    let made;
    if (unlit) {
        made = new THREE.MeshBasicMaterial(common);
    } else {
        made = new THREE.MeshLambertMaterial(common);
        made.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
                "#include <emissivemap_fragment>",
                "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * 0.22;",
            );
        };
        made.customProgramCacheKey = () => "commons-figure";
    }
    cache.set(key, made);
    return made;
}

/*
 * Every plain part of a person or creature moves to the figure set, which the
 * ASCII pass draws brighter and rings with empty space. Parts that already
 * chose a set (a glowing eye, a timber spear) keep it.
 *
 * Returns a clone, cached per source material's uuid and freed with the
 * rest. The clone is not cut away: Material.copy does not copy
 * onBeforeCompile, so it loses the cutaway() patch (people are not cut in
 * half).
 */
const figures = new Map();
export function asFigure(mat) {
    if (mat.opacity !== glyphCode(GLYPH_SETS.solid)) return mat;
    if (!figures.has(mat.uuid)) {
        const made = mat.clone();
        made.opacity = glyphCode(GLYPH_SETS.figure);
        /* Rounded figures shade smoothly, into ramps rather than facets. */
        made.flatShading = false;
        figures.set(mat.uuid, made);
    }
    return figures.get(mat.uuid);
}

/* What a figure turns into for the instant it is hit: solid white, in the
   figure glyph set (so the silhouette keeps its character ring). One shared
   instance, created on first use. */
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

/*
 * Materials are shared by every scene open at once (the Commons, the main
 * site, a page's diorama). A scene takes a hold with retainMaterials() once
 * it is past the point it can fail to start, and gives it back with the
 * hold's release() when it closes. Each hold counts once however often it
 * is released, and the materials are freed when the last hold goes, so
 * closing one scene (even twice) does not pull them out from under another.
 * disposeMaterials() frees them only while no scene holds them (tests use
 * it to reset between cases).
 *
 * Freed materials are simply dropped from the caches; a later material()
 * call makes new ones, so a scene opened afterwards still works.
 */
const holds = new Set();
export function retainMaterials() {
    const hold = {
        release() {
            if (!holds.delete(hold)) return;
            if (holds.size === 0) freeMaterials();
        },
    };
    holds.add(hold);
    return hold;
}

export function disposeMaterials() {
    if (holds.size === 0) freeMaterials();
}

function freeMaterials() {
    cache.forEach((m) => m.dispose());
    cache.clear();
    figures.forEach((m) => m.dispose());
    figures.clear();
    if (flashMaterial) flashMaterial.dispose();
    flashMaterial = null;
}

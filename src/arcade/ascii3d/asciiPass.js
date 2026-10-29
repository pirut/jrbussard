import * as THREE from "three";
import {
    BAYER4,
    BLACK_POINT,
    CODES,
    EDGE_BAND,
    FACE_RAMPS,
    GAINS,
    GLYPHS,
    GLYPH_SETS,
    HYSTERESIS,
    LEVELS,
    MAX_FAMILY,
    RAMPS,
    SET_NAMES,
    STICK,
    VARIANTS,
    familyIndices,
    glyphCode,
    tierFlags,
} from "./glyphs";
import { HistoryTracker } from "./history";

/*
 * Turning a 3D render into characters.
 *
 * Characters are not pixels: a "/" is dark in one corner and light in the
 * other, an "_" sits on the floor of its cell, a "'" hangs from the ceiling.
 * Picking a character by brightness alone throws all of that away and leaves
 * a dithered picture. So this picks by shape.
 *
 * The scene is drawn into an offscreen target four texels wide and six tall
 * per character cell. Every cell is read as a 2×3 grid of brightness, and
 * every character in the font has been measured the same way, once, from the
 * glyphs themselves. The character whose six numbers sit closest to the
 * cell's six wins: a roof edge running down to the left comes out as "/", the
 * top of a fence as "-", a lit cheek as "(". Edges and silhouettes fall out of
 * the matching, with no separate outline pass.
 *
 * Two passes. The first runs once per cell, at the size of the character
 * grid, and writes which character and what colour. The second runs per
 * screen pixel and stamps that character from an atlas.
 *
 * The tables (sets, families, ramps) and the rules for choosing live in
 * glyphs.js, without WebGL, so they can be tested and reused.
 *
 * Materials still have a say. Each writes a small code into alpha naming its
 * set, and a set can limit itself to a family of characters, so water only
 * ever draws in "~-=_" and grass in strokes, whatever the shapes suggest.
 * People and creatures are their own set, drawn brighter and ringed with
 * empty cells so they never melt into what stands behind them.
 */

export { GLYPH_SETS, glyphCode };

/* `?crt=1` asks for scanlines, bloom and a vignette. */
function crtRequested() {
    try {
        return new URLSearchParams(window.location.search).get("crt") === "1";
    } catch {
        return false;
    }
}

const REGIONS_X = 2;
const REGIONS_Y = 3;
export const SAMPLE_X = REGIONS_X * 2;
export const SAMPLE_Y = REGIONS_Y * 2;

const FONT = `"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Courier New", monospace`;

/* On whole pixels, so a stroke one pixel wide lands on one column of the
   screen instead of smearing grey across two. */
function drawGlyph(ctx, ch, x, cellW, cellH, stroke = false) {
    const cx = Math.round(x + cellW / 2);
    const cy = Math.round(cellH * 0.55);
    if (stroke) ctx.strokeText(ch, cx, cy, cellW);
    ctx.fillText(ch, cx, cy, cellW);
}

/*
 * The atlas the second pass stamps from: one row, one cell per character,
 * drawn at the size the screen uses. Red is the character itself. Green is
 * the character grown by a pixel or so all round: the second pass darkens
 * the wash under that rim, so a stroke stands clear of the painted colour
 * behind it however close the two are in brightness.
 */
export function buildAtlas(cellW, cellH) {
    const canvas = document.createElement("canvas");
    canvas.width = cellW * GLYPHS.length;
    canvas.height = cellH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `500 ${Math.round(cellH * 0.9)}px ${FONT}`;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#0f0";
    ctx.strokeStyle = "#0f0";
    ctx.lineWidth = Math.max(1.5, cellH / 7);
    ctx.lineJoin = "round";
    Array.from(GLYPHS).forEach((ch, i) => drawGlyph(ctx, ch, i * cellW, cellW, cellH, true));
    ctx.fillStyle = "#f00";
    Array.from(GLYPHS).forEach((ch, i) => drawGlyph(ctx, ch, i * cellW, cellW, cellH));
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.NoColorSpace;
    return { texture, count: GLYPHS.length };
}

/*
 * Each character's ink in its 2×3 regions, measured from a large rendering
 * so the numbers do not depend on the screen's cell size. Scaled so the
 * inkiest region of the inkiest character is 1.
 */
function measureGlyphs() {
    const w = 30;
    const h = 51;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `500 ${Math.round(h * 0.9)}px ${FONT}`;
    const shapes = Array.from(GLYPHS).map((ch) => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#fff";
        drawGlyph(ctx, ch, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const sums = new Array(REGIONS_X * REGIONS_Y).fill(0);
        for (let y = 0; y < h; y += 1) {
            const ry = Math.min(REGIONS_Y - 1, Math.floor((y / h) * REGIONS_Y));
            for (let x = 0; x < w; x += 1) {
                const rx = Math.min(REGIONS_X - 1, Math.floor((x / w) * REGIONS_X));
                sums[ry * REGIONS_X + rx] += data[(y * w + x) * 4] / 255;
            }
        }
        const area = (w / REGIONS_X) * (h / REGIONS_Y);
        return sums.map((s) => s / area);
    });
    const peak = Math.max(...shapes.flat());
    return shapes.map((s) => s.map((v) => v / peak));
}

/* Shapes and families, as a float texture the first pass reads by index:
   row 0 holds regions 0–3, row 1 regions 4–5, and row 2 + set lists the
   characters that set may use, so the search only visits those (a set has
   at most MAX_FAMILY of them). */
function buildShapeTexture() {
    const shapes = measureGlyphs();
    const n = GLYPHS.length;
    const names = SET_NAMES;
    const rows = 2 + names.length * 2;
    const data = new Float32Array(n * rows * 4);
    shapes.forEach((s, i) => {
        data.set([s[0], s[1], s[2], s[3]], i * 4);
        data.set([s[4], s[5], 0, 0], (n + i) * 4);
    });
    names.forEach((name) => {
        familyIndices(name).forEach((g, k) => {
            data[((2 + GLYPH_SETS[name]) * n + k) * 4] = g;
        });
    });
    /* Then one row per set of ramp entries: level × variant → character. */
    RAMPS.forEach((levels, set) => {
        levels.forEach((variants, level) => {
            Array.from(variants).forEach((ch, v) => {
                data[((2 + names.length + set) * n + level * VARIANTS + v) * 4] = GLYPHS.indexOf(ch);
            });
        });
    });
    const texture = new THREE.DataTexture(data, n, rows, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
}

const idx = (ch) => GLYPHS.indexOf(ch).toFixed(1);

const fullscreen = /* glsl */ `
    void main() {
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

/* Pass one: per cell, which character and what colour. */
const pickShader = /* glsl */ `
    precision highp float;
    precision highp int;

    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform sampler2D tShapes;
    uniform vec2 uCells;
    uniform float uNear;
    uniform float uFar;
    uniform float uGain;
    uniform float uSharp;
    uniform float uEdge;
    uniform float uInk;
    uniform float uRamp;
    uniform float uContrast;
    uniform float uTime;
    uniform float uRain;
    uniform vec3 uRainColor;
    uniform float uStars;
    uniform float uClouds;
    uniform vec3 uCloudColor;
    uniform float uSkyShift;
    uniform float uSkyTurn;
    uniform vec3 uHorizon;
    uniform float uMoon;
    uniform float uFlash;
    uniform float uOutline;
    uniform vec2 uCellPx;
    uniform float uJoints;
    uniform sampler2D tGhost;
    uniform float uGhost;
    uniform vec3 uGhostColor;
    uniform mat4 uInvProj;
    uniform mat4 uCamToWorld;
    uniform float uOrtho;
    uniform vec2 uCellShift;
    /* Last frame's cells, for holding a choice steady, and how many cells
       the world has slid since (so the same patch of ground is compared). */
    uniform sampler2D tPrev;
    uniform float uHistory;
    uniform vec2 uHistShift;
    uniform float uDither;
    uniform float uDepthCue;

    const int MAX_FAMILY = ${MAX_FAMILY};
    const float FAMILY_SIZE[${SET_NAMES.length}] = float[${SET_NAMES.length}](${SET_NAMES.map((name) => familyIndices(name).length.toFixed(1)).join(", ")});
    const float BAYER[16] = float[16](${BAYER4.map((v) => v.toFixed(5)).join(", ")});
    const float BAND = ${HYSTERESIS.toFixed(3)};
    const float STICK = ${STICK.toFixed(3)};
    const float EDGE_BAND = ${EDGE_BAND.toFixed(3)};
    const float CODES = ${CODES.toFixed(1)};
    const float FIGURE = ${GLYPH_SETS.figure.toFixed(1)};
    const float WATER = ${GLYPH_SETS.water.toFixed(1)};
    const float SOLID = ${GLYPH_SETS.solid.toFixed(1)};
    const float TIMBER = ${GLYPH_SETS.timber.toFixed(1)};
    const float ROCK = ${GLYPH_SETS.rock.toFixed(1)};
    const float PATH = ${GLYPH_SETS.path.toFixed(1)};
    const float TOP_RAMP[${LEVELS}] = float[${LEVELS}](${Array.from(FACE_RAMPS[0]).map(idx).join(", ")});
    const float LEFT_RAMP[${LEVELS}] = float[${LEVELS}](${Array.from(FACE_RAMPS[1]).map(idx).join(", ")});
    const float RIGHT_RAMP[${LEVELS}] = float[${LEVELS}](${Array.from(FACE_RAMPS[2]).map(idx).join(", ")});
    const float GAINS[${GAINS.length}] = float[${GAINS.length}](${GAINS.map((g) => g.toFixed(2)).join(", ")});

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }

    vec3 toSrgb(vec3 c) {
        return pow(max(c, 0.0), vec3(1.0 / 2.2));
    }

    /* Depth along the view. An orthographic camera stores it linearly. */
    float linearDepth(float d) {
        return uOrtho > 0.5 ? uNear + d * (uFar - uNear) : (uNear * uFar) / (uFar - d * (uFar - uNear));
    }

    float viewDepth(vec2 uv) {
        return linearDepth(texture(tDepth, uv).r);
    }

    /* How big a jump in depth is, for finding silhouettes. In perspective
       it is relative to how far off it is; looking straight down the
       isometric diagonal everything is equally far, so a fixed scale. */
    float depthJump(float jump, float d) {
        return uOrtho > 0.5 ? jump / 9.0 : jump / d;
    }

    /* Where on the ground a point of the screen lands, in world units. */
    vec2 groundAt(vec2 uv) {
        float z = texture(tDepth, uv).r * 2.0 - 1.0;
        vec4 view = uInvProj * vec4(uv * 2.0 - 1.0, z, 1.0);
        vec4 world = uCamToWorld * vec4(view.xyz / view.w, 1.0);
        return world.xz + 0.5;
    }

    /* The depth of the one figure that must never be lost, drawn on its own. */
    float ghostDepth(vec2 uv) {
        float g = texture(tGhost, uv).r;
        return g >= 1.0 ? 1e9 : linearDepth(g);
    }

    /* The world position under a texel of the scene target. */
    vec3 worldAtTexel(ivec2 t) {
        vec2 size = uCells * vec2(${SAMPLE_X}.0, ${SAMPLE_Y}.0);
        float z = texelFetch(tDepth, t, 0).r * 2.0 - 1.0;
        vec4 view = uInvProj * vec4((vec2(t) + 0.5) / size * 2.0 - 1.0, z, 1.0);
        return (uCamToWorld * vec4(view.xyz / view.w, 1.0)).xyz;
    }

    /* Which way the surface under a texel looks, seen from the isometric
       camera: 0 up (a roof, a floor), 1 a wall facing left on screen, 2 a
       wall facing right, -1 open sky. */
    float faceAtTexel(ivec2 t) {
        if (texelFetch(tDepth, t, 0).r >= 0.99999) return -1.0;
        vec3 p = worldAtTexel(t);
        vec3 n = cross(worldAtTexel(t + ivec2(1, 0)) - p, worldAtTexel(t + ivec2(0, 1)) - p);
        float len = length(n);
        if (len < 1e-6) return -1.0;
        n /= len;
        if (n.y > 0.6) return 0.0;
        return dot(n, uCamToWorld[0].xyz) < 0.0 ? 1.0 : 2.0;
    }

    float setAt(vec2 cell) {
        vec2 c = clamp(cell, vec2(0.0), uCells - 1.0);
        ivec2 texel = ivec2(c * vec2(${SAMPLE_X}.0, ${SAMPLE_Y}.0)) + ivec2(${SAMPLE_X / 2}, ${SAMPLE_Y / 2});
        return floor(texelFetch(tColor, texel, 0).a * CODES);
    }

    /* The character drawn in this patch of world last frame, or -1. */
    float prevGlyph(vec2 cell) {
        if (uHistory < 0.5) return -1.0;
        vec2 c = cell + uHistShift;
        if (c.x < 0.0 || c.y < 0.0 || c.x >= uCells.x || c.y >= uCells.y) return -1.0;
        float code = floor(texelFetch(tPrev, ivec2(c), 0).a * 255.0 + 0.5);
        return code >= 128.0 ? code - 128.0 : code;
    }

    float rampAt(int setIndex, float level, float variant) {
        return texelFetch(tShapes, ivec2(int(clamp(level, 0.0, ${LEVELS - 1}.0) * ${VARIANTS}.0 + variant), 2 + ${SET_NAMES.length} + setIndex), 0).r;
    }

    float faceAt(int f, float level) {
        int l = int(clamp(level, 0.0, ${LEVELS - 1}.0));
        return f == 0 ? TOP_RAMP[l] : f == 1 ? LEFT_RAMP[l] : RIGHT_RAMP[l];
    }

    /* glyphs.js stickyLevel(): keep last frame's level next door unless the
       reading is clearly past the boundary. Here judged by the character,
       since that is what last frame kept. */
    float holdLevel(float x, float level, float prev, float down, float up) {
        if (prev < 0.0) return level;
        if (prev == down && x - level < BAND) return level - 1.0;
        if (prev == up && level + 1.0 - x < BAND) return level + 1.0;
        return level;
    }

    /* Rain falls in slanted lanes of cells, a short run of / per drop. */
    float rainAt(vec2 cell) {
        float lane = cell.x - floor(cell.y * 0.5);
        float pick = hash(vec2(lane, 7.0));
        if (pick > uRain * 0.7) return 0.0;
        float period = uCells.y + 24.0;
        float speed = 34.0 + pick * 60.0;
        float head = mod(hash(vec2(lane, 3.0)) * period - uTime * speed, period) - 12.0;
        float along = cell.y - head;
        float len = 2.0 + floor(pick * 6.0);
        if (along < 0.0 || along >= len) return 0.0;
        return 1.0 - along / len * 0.7;
    }

    void main() {
        vec2 cell = floor(gl_FragCoord.xy);
        vec2 uv = (cell + 0.5) / uCells;
        float set = setAt(cell);
        int setIndex = int(clamp(set, 0.0, ${Object.keys(GLYPH_SETS).length - 1}.0));
        int setRow = 2 + setIndex;

        /* Six readings: two across, three down, top row first. */
        float lum[6];
        vec3 sum = vec3(0.0);
        float gain = GAINS[int(clamp(set, 0.0, ${GAINS.length - 1}.0))] * uGain;
        float peak = 0.0;
        for (int i = 0; i < 6; i++) {
            float rx = float(i % 2);
            float ry = float(i / 2);
            vec2 at = (cell + vec2((rx + 0.5) / 2.0, 1.0 - (ry + 0.5) / 3.0)) / uCells;
            vec3 c = toSrgb(texture(tColor, at).rgb);
            sum += c;
            /* A black point, so the dark stays empty rather than dusted. */
            lum[i] = max(0.0, dot(c, vec3(0.2126, 0.7152, 0.0722)) - ${BLACK_POINT}) * gain;
            peak = max(peak, lum[i]);
        }
        vec3 color = sum / 6.0;

        /* Sharpen within the cell: pull each reading away from the cell's
           brightest by a power, so a half-lit cell picks a half-inked glyph
           instead of an even grey one. */
        float d = viewDepth(uv);
        float low = min(min(min(lum[0], lum[1]), min(lum[2], lum[3])), min(lum[4], lum[5]));
        float spread = peak > 0.0 ? (peak - low) / peak : 0.0;
        /* Only where the cell really holds an edge: on a merely textured
           surface, sharpening turns noise into stray letters. */
        float sharp = mix(1.0, uSharp, smoothstep(0.25, 0.6, spread));
        if (peak > 0.0) {
            for (int i = 0; i < 6; i++) lum[i] = pow(lum[i] / peak, sharp) * peak;
        }

        /* Background cells beside or above a figure that stands in front of
           them go quiet, which outlines the figure in empty space. Not the
           cells under its feet: the ground it stands on stays drawn, so a
           figure stands on something instead of floating in a gap. */
        float halo = 1.0;
        if (set != FIGURE) {
            vec2 step = 1.0 / uCells;
            if ((setAt(cell + vec2(1.0, 0.0)) == FIGURE && viewDepth(uv + vec2(step.x, 0.0)) < d) ||
                (setAt(cell - vec2(1.0, 0.0)) == FIGURE && viewDepth(uv - vec2(step.x, 0.0)) < d) ||
                (setAt(cell - vec2(0.0, 1.0)) == FIGURE && viewDepth(uv - vec2(0.0, step.y)) < d)) {
                halo = 0.25;
            }
        }

        /* Seen from above, built things are drawn by their faces: which
           way each sixth of the cell looks, and whether the cell holds a
           crease where two faces meet. */
        bool built = uOrtho > 0.5 && (set == SOLID || set == TIMBER || set == ROCK);
        float faces[6];
        float face = -1.0;
        bool crease = false;
        float creaseGlyph = 0.0;
        if (built) {
            ivec2 base = ivec2(cell) * ivec2(${SAMPLE_X}, ${SAMPLE_Y});
            vec3 mid = worldAtTexel(base + ivec2(${SAMPLE_X / 2}, ${SAMPLE_Y / 2}));
            float lo = 9.0;
            float hi = -9.0;
            for (int i = 0; i < 6; i++) {
                ivec2 t = base + ivec2((i % 2) * 2, 4 - (i / 2) * 2);
                float f = faceAtTexel(t);
                /* Across a drop to something far behind, that is a
                   silhouette, not a crease: the outline below draws it. */
                if (f >= 0.0 && distance(worldAtTexel(t), mid) > 1.2) f = -1.0;
                faces[i] = f;
                if (f >= 0.0) {
                    lo = min(lo, f);
                    hi = max(hi, f);
                }
            }
            face = faces[2] >= 0.0 ? faces[2] : faces[3];
            /* A crease needs each face on at least two of the six samples:
               one odd sample is a bump in the rock, not an edge, and
               drawing it turns a cliff into a scribble of strokes. */
            float nLo = 0.0;
            float nHi = 0.0;
            for (int i = 0; i < 6; i++) {
                nLo += faces[i] == lo ? 1.0 : 0.0;
                nHi += faces[i] == hi ? 1.0 : 0.0;
            }
            if (hi > lo && (nLo < 2.0 || nHi < 2.0)) {
                face = nLo >= nHi ? lo : hi;
                hi = lo;
            }
            if (hi > lo) {
                /* A crease inside the cell: a stroke along it, shaped by
                   where the lower-numbered face lies. */
                float v[6];
                for (int i = 0; i < 6; i++) v[i] = faces[i] == lo ? 1.0 : 0.0;
                float gx = ((v[1] + v[3] + v[5]) - (v[0] + v[2] + v[4])) / 3.0 / (uCellPx.x * 0.5);
                float gy = ((v[0] + v[1]) - (v[4] + v[5])) / 2.0 / (uCellPx.y * 0.667);
                float a = atan(abs(gy), abs(gx));
                bool upper = v[0] + v[1] != v[2] + v[3];
                if (a < 0.45) creaseGlyph = ${idx("|")};
                else if (a > 1.15) creaseGlyph = upper ? ${idx("-")} : ${idx("_")};
                else creaseGlyph = gx * gy > 0.0 ? ${idx("\\")} : ${idx("/")};
                crease = true;
            } else if (face >= 0.0) {
                /* A crease along the cell's own border belongs to whichever
                   side has the lower number, so it is drawn once. */
                float right = faceAtTexel(base + ivec2(${SAMPLE_X}, 2));
                float left = faceAtTexel(base + ivec2(-2, 2));
                float below = faceAtTexel(base + ivec2(1, -2));
                float above = faceAtTexel(base + ivec2(1, ${SAMPLE_Y}));
                if (below > face && distance(worldAtTexel(base + ivec2(1, -2)), mid) < 1.2) {
                    creaseGlyph = ${idx("_")};
                    crease = true;
                } else if ((right > face && distance(worldAtTexel(base + ivec2(${SAMPLE_X}, 2)), mid) < 1.2) ||
                           (left > face && distance(worldAtTexel(base + ivec2(-2, 2)), mid) < 1.2)) {
                    creaseGlyph = ${idx("|")};
                    crease = true;
                } else if (above > face && distance(worldAtTexel(base + ivec2(1, ${SAMPLE_Y})), mid) < 1.2) {
                    creaseGlyph = ${idx("-")};
                    crease = true;
                }
            }
        }

        int choice = 0;
        float prev = prevGlyph(cell);
        float mean = (lum[0] + lum[1] + lum[2] + lum[3] + lum[4] + lum[5]) / 6.0 * halo;
        /* Keyed to the world rather than the screen (uCellShift is how many
           whole cells the camera has moved), so walking slides textures and
           dither along with the ground instead of re-rolling them. */
        vec2 key = cell + uCellShift;
        vec2 k4 = mod(key, 4.0);
        float threshold = BAYER[int(k4.y) * 4 + int(k4.x)];
        if (built && face >= 0.0) {
            /* Built, from above: the face's own texture, by brightness. */
            float x = pow(clamp(mean * uRamp, 0.0, 0.999), uContrast) * ${LEVELS}.0 + (threshold - 0.5) * uDither * 0.6;
            float level = floor(x);
            int f = int(face);
            level = holdLevel(x, level, prev, faceAt(f, level - 1.0), faceAt(f, level + 1.0));
            /* Even a wall in shadow keeps its grain, faint, so it stays
               a wall and not a hole. */
            level = clamp(level, mean > 0.015 ? 2.0 : 0.0, ${LEVELS - 3}.0);
            choice = int(faceAt(f, level));
            if (crease) choice = int(creaseGlyph);
        } else {
            /* Flat: a density from the ramp, a character from the hash.
               A curve on the way in: dim faces thin out to dots, so the
               lit ones and the edges stand clear of them. */
            float curve = set == FIGURE ? 1.0 : uContrast;
            float x = pow(clamp(mean * uRamp, 0.0, 0.999), curve) * ${LEVELS}.0 + (threshold - 0.5) * uDither;
            float level = floor(x);
            /* Water turns over a cell at a time, each on its own beat,
               rather than the whole sea at once. */
            float shuffle = set == WATER ? floor(uTime * 0.6 + hash(key.yx + 5.3)) : 0.0;
            float variant = floor(hash(key + shuffle * vec2(3.1, 1.7)) * ${VARIANTS}.0);
            level = holdLevel(x, level, prev, rampAt(setIndex, level - 1.0, variant), rampAt(setIndex, level + 1.0, variant));
            /* And a ceiling, where the curve is on: a sunlit wall stays a
               page of letters rather than a slab of @ and W. */
            if (uContrast > 1.0 && set != FIGURE) level = min(level, set == WATER ? ${LEVELS - 2}.0 : ${LEVELS - 3}.0);
            /* Paving with its joints drawn needs only a light grain between
               them; the joints and the light carry the floor. */
            if (uJoints > 0.0 && set == PATH) level = min(level, uOrtho > 0.5 ? 2.0 : 4.0);
            level = clamp(level, 0.0, ${LEVELS - 1}.0);
            float even = rampAt(setIndex, level, variant);
            choice = int(even);

            /* An edge runs through this cell: find the character shaped
               most like it, among the set's own. Near the cut, a cell
               that was flat last frame stays flat, and the character drawn
               last frame wins a near-tie, so edges do not shimmer. */
            /* glyphs.js isEdge(); with no history, the plain cut. */
            bool edge = peak > 0.08 && (prev < 0.0 ? spread > uEdge : spread > uEdge + EDGE_BAND || (spread > uEdge - EDGE_BAND && prev != even));
            if (edge) {
                float best = 1e9;
                int count = int(FAMILY_SIZE[setIndex]);
                for (int k = 0; k < MAX_FAMILY; k++) {
                    if (k >= count) break;
                    int g = int(texelFetch(tShapes, ivec2(k, setRow), 0).r);
                    vec4 a = texelFetch(tShapes, ivec2(g, 0), 0);
                    vec4 b = texelFetch(tShapes, ivec2(g, 1), 0);
                    vec4 da = a - vec4(lum[0], lum[1], lum[2], lum[3]) * halo;
                    vec2 db = b.xy - vec2(lum[4], lum[5]) * halo;
                    float e = dot(da, da) + dot(db, db);
                    if (float(g) == prev) e *= STICK;
                    if (e < best) {
                        best = e;
                        choice = g;
                    }
                }
            }
        }

        /* Depth: a cell just behind something nearer (beside it, or above
           it on screen) sits in that thing's shadow and draws dimmer, so
           every silhouette stands off what lies behind it, not only
           figures. */
        float behind = 1.0;
        if (uDepthCue > 0.0 && set != FIGURE && texture(tDepth, uv).r < 0.99999) {
            vec2 step = 1.0 / uCells;
            float jump = max(max(d - viewDepth(uv + vec2(step.x, 0.0)), d - viewDepth(uv - vec2(step.x, 0.0))), d - viewDepth(uv + vec2(0.0, step.y)));
            behind = 1.0 - uDepthCue * smoothstep(uOutline * 2.5, uOutline * 6.0, depthJump(jump, d));
        }

        /* The scene's colour, lifted to read as ink on the dark. Figures keep
           their hue at full strength, so a purple coat stays purple rather
           than washing out to cream. */
        vec3 ink = clamp(color * 1.5 * uInk + 0.03, 0.0, 1.0);
        if (set == FIGURE) {
            float top = max(max(color.r, color.g), color.b);
            ink = clamp(color / max(top, 0.03) * (0.62 + top * 0.6), 0.0, 1.0);
        }
        ink *= behind;
        float glyph = float(choice);
        /* A crease is a line drawn on the block, a shade lighter than its
           faces. */
        if (crease) ink = min(ink * 1.25 + 0.04, 1.0);

        /* Outlines. Where the depth drops away across a cell, the cell sits on
           the near side of a silhouette: draw the edge as a stroke running
           along it, so figures and buildings read by their shape. */
        if (set == FIGURE || set == SOLID || set == TIMBER || set == ROCK) {
            vec2 hx = vec2(0.5 / uCells.x, 0.0);
            vec2 hy = vec2(0.0, 0.5 / uCells.y);
            float dl = viewDepth(uv - hx);
            float dr = viewDepth(uv + hx);
            float dd = viewDepth(uv - hy);
            float du = viewDepth(uv + hy);
            float far = max(max(dl, dr), max(dd, du));
            float near = min(min(dl, dr), min(dd, du));
            float limit = set == FIGURE ? uOutline : uOutline * 2.5;
            /* Only the near side of the jump, so each outline belongs to the
               thing in front. */
            if (depthJump(far - d, d) > limit && (d - near) < (far - d) * 0.5) {
                vec2 g = vec2((dr - dl) / uCellPx.x, (du - dd) / uCellPx.y);
                float a = atan(abs(g.y), abs(g.x));
                if (a < 0.42) glyph = ${idx("|")};
                else if (a > 1.15) glyph = g.y > 0.0 ? ${idx("_")} : ${idx("-")};
                else glyph = g.x * g.y > 0.0 ? ${idx("\\")} : ${idx("/")};
                ink = min(ink * 1.2 + 0.05, 1.0);
            }
        }

        /* Paving. Every tile of ground is a flag or a sett, and the joints
           between them run off in perspective, which gives the floor a
           scale and says how far away things stand. Only where a joint is
           finer than a cell; further off the joints would merge to noise. */
        if (uJoints > 0.0 && set == PATH && uOrtho < 0.5) {
            vec2 hx = vec2(0.5 / uCells.x, 0.0);
            vec2 hy = vec2(0.0, 0.5 / uCells.y);
            vec2 gl = groundAt(uv - hx);
            vec2 gr = groundAt(uv + hx);
            vec2 gd = groundAt(uv - hy);
            vec2 gu = groundAt(uv + hy);
            vec2 gc = groundAt(uv);
            vec2 span = max(abs(gr - gl), abs(gu - gd));
            for (int k = 0; k < 2; k++) {
                vec2 g = k == 0 ? vec2(gr.x - gl.x, gu.x - gd.x) : vec2(gr.y - gl.y, gu.y - gd.y);
                float v = k == 0 ? gc.x : gc.y;
                /* A joint runs through this cell if one lies within half a
                   cell of its middle, measured the long way, so a slanting
                   joint takes one cell a row rather than two. From above,
                   flags are two tiles across and the joints finer, or the
                   floor turns to wickerwork. */
                float reach = 0.5 * max(abs(g.x), abs(g.y));
                if (uOrtho > 0.5) {
                    v *= 0.5;
                    g *= 0.5;
                    reach *= 0.45;
                }
                /* Seen from above every cell spans a good part of a tile
                   on the slant, so the isometric view allows more. */
                if (abs(g.x) + abs(g.y) > (uOrtho > 0.5 ? 0.9 : 0.4) || abs(v - floor(v + 0.5)) > reach) continue;
                g /= uCellPx;
                float ang = atan(abs(g.y), abs(g.x));
                if (ang < 0.5) glyph = ${idx("|")};
                else if (ang > 1.2) glyph = ${idx("_")};
                else glyph = g.x * g.y > 0.0 ? ${idx("\\")} : ${idx("/")};
                float near = 1.0 - smoothstep(0.15, 0.4, max(span.x, span.y));
                ink = ink * (0.75 + 0.3 * near * uJoints) + 0.03 * near * uJoints;
                break;
            }
        }

        /* From above, paving is marked only where four flags meet: a light
           grid of corners that gives the floor its scale without turning it
           into wickerwork. */
        if (uJoints > 0.0 && set == PATH && uOrtho > 0.5) {
            vec2 hx = vec2(0.5 / uCells.x, 0.0);
            vec2 hy = vec2(0.0, 0.5 / uCells.y);
            vec2 gc = groundAt(uv);
            mat2 span = mat2(groundAt(uv + hx) - groundAt(uv - hx), groundAt(uv + hy) - groundAt(uv - hy));
            vec2 off = gc - floor(gc + 0.5);
            if (abs(determinant(span)) > 1e-5) {
                vec2 ab = inverse(span) * off;
                if (abs(ab.x) <= 0.5 && abs(ab.y) <= 0.5) {
                    glyph = ${idx("+")};
                    ink = ink * 0.85 + 0.02;
                }
            }
        }

        /* You, behind something. Where a wall, a bridge or an overhang hides
           JR, JR shows through it as a ghost in outline, so you never lose
           yourself in the warren and nothing has to be cut away. */
        if (uGhost > 0.0) {
            float gd = ghostDepth(uv);
            if (gd < 1e8 && d < gd - 0.3) {
                vec2 sx = vec2(1.0 / uCells.x, 0.0);
                vec2 sy = vec2(0.0, 1.0 / uCells.y);
                bool edge = ghostDepth(uv + sx) > 1e8 || ghostDepth(uv - sx) > 1e8
                         || ghostDepth(uv + sy) > 1e8 || ghostDepth(uv - sy) > 1e8;
                glyph = edge ? ${idx("#")} : (mod(cell.x + cell.y, 2.0) < 1.0 ? ${idx(":")} : ${idx(".")});
                ink = mix(ink * 0.4, uGhostColor, edge ? 0.95 : 0.6);
                set = FIGURE;
            }
        }

        /* Open sky: stars and slow bands of cloud, pinned to the heading so
           they wheel past as the camera turns. */
        if (texture(tDepth, uv).r >= 0.99999) {
            vec2 sc = vec2(cell.x + uSkyShift, cell.y);
            float clouds = noise(vec2(sc.x * 0.045 + uTime * 0.12, sc.y * 0.2)) * 0.65
                         + noise(vec2(sc.x * 0.11 - uTime * 0.05, sc.y * 0.45)) * 0.35;
            float cover = clouds - (0.66 - uClouds * 0.3);
            float h = hash(floor(sc));
            glyph = 0.0;
            /* The glow a lit city throws up into the haze above it, washed
               behind the stars rather than drawn. */
            ink = uHorizon * pow(1.0 - uv.y, 1.6);
            /* And a moon, fixed to one heading. Cells are taller than they
               are wide, so the disc is measured in cell heights. */
            float mdx = mod(sc.x - uSkyTurn * 0.08 + uSkyTurn * 0.5, uSkyTurn) - uSkyTurn * 0.5;
            vec2 md = vec2(mdx * 0.58, cell.y - uCells.y * 0.86);
            float mr = length(md) / 4.0;
            if (uMoon > 0.0 && mr < 1.0) {
                float shade = 1.0 - mr * mr * 0.4 - noise(cell * 0.6 + 3.0) * 0.4;
                glyph = shade > 0.7 ? ${idx("@")} : shade > 0.52 ? ${idx("%")} : ${idx("*")};
                /* The rim is drawn as strokes along the curve. */
                if (mr > 0.8) {
                    float a = atan(abs(md.y), abs(md.x));
                    glyph = a > 1.1 ? ${idx("-")} : a < 0.45 ? ${idx("|")} : md.x * md.y > 0.0 ? ${idx("\\")} : ${idx("/")};
                }
                ink = vec3(0.96, 0.92, 0.8) * (0.7 + shade * 0.3) * uMoon;
            } else if (uMoon > 0.0 && mr < 3.0) {
                ink += vec3(0.75, 0.78, 0.9) * pow(1.0 - (mr - 1.0) / 2.0, 2.0) * 0.9 * uMoon;
                if (h < 0.022 * uStars && mr > 1.6) glyph = ${idx(".")};
            } else if (cover > 0.0) {
                float k = hash(sc + 9.1);
                glyph = cover > 0.12 ? (k < 0.5 ? ${idx("~")} : ${idx("=")}) : (k < 0.5 ? ${idx("-")} : ${idx(".")});
                ink = uCloudColor * (0.55 + cover * 1.5) + uFlash * 0.6;
            } else if (h < 0.022 * uStars) {
                float twinkle = 0.55 + 0.45 * sin(uTime * (1.3 + h * 90.0) + h * 400.0);
                float k = hash(sc + 4.7);
                glyph = k < 0.6 ? ${idx(".")} : k < 0.85 ? ${idx("+")} : ${idx("*")};
                ink = vec3(0.78, 0.84, 1.0) * twinkle * uStars;
            }
        }

        float drop = uRain > 0.0 ? rainAt(cell) : 0.0;
        if (drop > 0.0) {
            glyph = ${idx("/")};
            ink = mix(ink * 0.5, uRainColor, drop * 0.85);
        }

        /* Figures and lights also flag their cell, so the second pass backs
           them with a stronger wash of their own colour: a person reads as a
           coloured shape, a window as a lit pane. */
        float body = (set == FIGURE || set == ${GLYPH_SETS.light}.0) && glyph != 0.0 && texture(tDepth, uv).r < 0.99999 ? 128.0 : 0.0;
        gl_FragColor = vec4(ink, (glyph + body) / 255.0);
    }
`;

/*
 * Light spilling from windows, lanterns and fire onto what is around them:
 * a soft wash behind the characters, gathered from a ring of samples about
 * the cell. Only sets that shine contribute. It depends only on the cell, so
 * it runs once per cell into its own small target rather than for every
 * pixel of the screen.
 */
const glowShader = /* glsl */ `
    precision highp float;

    uniform sampler2D tColor;
    uniform vec2 uCells;

    const float CODES = ${CODES.toFixed(1)};

    void main() {
        vec2 cell = floor(gl_FragCoord.xy);
        vec3 sum = vec3(0.0);
        for (int r = 1; r <= 2; r++) {
            float rad = float(r) * 1.6;
            for (int i = 0; i < 8; i++) {
                float a = float(i) * 0.7854 + float(r) * 0.39;
                vec2 at = (cell + 0.5 + vec2(cos(a), sin(a) * 0.6) * rad) / uCells;
                vec4 c = texture(tColor, at);
                float set = floor(c.a * CODES);
                if (set == ${GLYPH_SETS.light}.0 || set == ${GLYPH_SETS.fire}.0) {
                    sum += pow(max(c.rgb, 0.0), vec3(1.0 / 2.2)) / float(r);
                }
            }
        }
        gl_FragColor = vec4(sum / 12.0, 1.0);
    }
`;

/* Pass two: stamp each cell's character. */
const drawShader = /* glsl */ `
    precision highp float;

    uniform sampler2D tPick;
    uniform sampler2D tGlyphs;
    uniform sampler2D tColor;
    uniform vec2 uCells;
    uniform vec2 uCellPx;
    uniform vec2 uOffset;
    uniform float uCount;
    uniform vec3 uBackground;
    uniform float uFill;
    uniform float uGlow;
    uniform float uRaw;
    uniform float uRim;
    uniform float uCrt;
    uniform sampler2D tDepth;
    uniform float uWash;
    uniform sampler2D tGlow;

    void main() {
        vec2 frag = gl_FragCoord.xy - uOffset;
        vec2 cell = floor(frag / uCellPx);
        if (frag.x < 0.0 || frag.y < 0.0 || cell.x >= uCells.x || cell.y >= uCells.y) {
            gl_FragColor = vec4(uBackground, 1.0);
            return;
        }
        if (uRaw > 0.5) {
            vec3 c = texture(tColor, frag / (uCells * uCellPx)).rgb;
            gl_FragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
            return;
        }
        vec4 pick = texelFetch(tPick, ivec2(cell), 0);
        float code = floor(pick.a * 255.0 + 0.5);
        float body = step(128.0, code);
        float glyph = code - body * 128.0;
        vec2 local = fract(frag / uCellPx);
        vec2 at = vec2((glyph + local.x) / uCount, local.y);
        vec2 ink = texture(tGlyphs, at).rg;
        float mask = ink.r;
        vec3 glow = uGlow > 0.0 ? texelFetch(tGlow, ivec2(cell), 0).rgb * uGlow : vec3(0.0);
        /* The wash behind the type is the scene itself, read at the
           pixel and smoothed, so a wall is a soft painted mass with
           characters on it rather than a mosaic of flat cells. The sky
           keeps its cell's colour. */
        vec2 suv = frag / (uCells * uCellPx);
        vec3 scene = texture(tDepth, suv).r < 0.99999 ? pow(max(texture(tColor, suv).rgb, 0.0), vec3(1.0 / 2.2)) * uWash : pick.rgb * 0.5;
        vec3 base = mix(uBackground, scene, max(uFill, body * 0.55)) + glow * 0.55;
        /* The rim round each stroke, darkened, so the type reads crisply
           over a wash of much the same colour. */
        base *= 1.0 - clamp(ink.g - mask, 0.0, 1.0) * uRim * (1.0 - uCrt * 0.6);
        vec3 color = mix(base, min(pick.rgb + glow * 0.35, 1.0), mask);
        if (uCrt > 0.0) {
            /* An old terminal, if asked for: the rim becomes a phosphor
               bloom round each stroke, every other line of pixels is a
               touch darker, and the corners fall away. */
            color += pick.rgb * clamp(ink.g - mask, 0.0, 1.0) * 0.3 * uCrt;
            color *= 1.0 - 0.14 * uCrt * step(1.0, mod(gl_FragCoord.y, 2.0));
            vec2 v = suv * 2.0 - 1.0;
            color *= 1.0 - uCrt * 0.35 * pow(dot(v * vec2(0.8, 0.9), v * vec2(0.8, 0.9)), 1.5);
        }
        gl_FragColor = vec4(color, 1.0);
    }
`;

/*
 * Both passes, sized to the character grid. AsciiWorld renders the scene
 * into `target`, then calls render().
 */
export class AsciiPass {
    constructor() {
        this.shapes = buildShapeTexture();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.pickMaterial = new THREE.ShaderMaterial({
            vertexShader: fullscreen,
            fragmentShader: pickShader,
            blending: THREE.NoBlending,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                tColor: { value: null },
                tDepth: { value: null },
                tShapes: { value: this.shapes },
                uCells: { value: new THREE.Vector2(1, 1) },
                uNear: { value: 0.1 },
                uFar: { value: 200 },
                uGain: { value: 0.95 },
                uSharp: { value: 1.8 },
                uEdge: { value: 0.5 },
                /* How hard the scene's colour is lifted into ink. */
                uInk: { value: 1 },
                uRamp: { value: 1.7 },
                /* Above 1, flat stretches thin out faster as they darken. */
                uContrast: { value: 1 },
                uTime: { value: 0 },
                uRain: { value: 0 },
                uRainColor: { value: new THREE.Color(0x9fb8d8) },
                uStars: { value: 0 },
                uClouds: { value: 0 },
                uCloudColor: { value: new THREE.Color(0x2a3550) },
                uSkyShift: { value: 0 },
                /* How many cells the sky moves through in a full turn. */
                uSkyTurn: { value: 1000 },
                uHorizon: { value: new THREE.Color(0x000000) },
                uMoon: { value: 0 },
                uFlash: { value: 0 },
                uOutline: { value: 0.035 },
                uCellPx: { value: new THREE.Vector2(8, 14) },
                /* Above 0, the joints of the paving are drawn. Needs the
                   camera matrices below. */
                uJoints: { value: 0 },
                uInvProj: { value: new THREE.Matrix4() },
                tGhost: { value: null },
                uGhost: { value: 0 },
                uGhostColor: { value: new THREE.Color(0xbfe6ff) },
                uCamToWorld: { value: new THREE.Matrix4() },
                /* 1 for an orthographic (isometric) camera. */
                uOrtho: { value: 0 },
                /* Whole cells the camera has moved, from snapIsoCamera(). */
                uCellShift: { value: new THREE.Vector2(0, 0) },
                tPrev: { value: null },
                uHistory: { value: 0 },
                uHistShift: { value: new THREE.Vector2(0, 0) },
                /* How far ordered dithering may push a flat cell across a
                   level, 0 to 1. */
                uDither: { value: 0.4 },
                /* How much a cell behind a nearer silhouette dims, 0 to 1. */
                uDepthCue: { value: 0.45 },
            },
        });
        this.drawMaterial = new THREE.ShaderMaterial({
            vertexShader: fullscreen,
            fragmentShader: drawShader,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                tPick: { value: null },
                tGlyphs: { value: null },
                tColor: { value: null },
                uCells: { value: new THREE.Vector2(1, 1) },
                uCellPx: { value: new THREE.Vector2(8, 14) },
                uOffset: { value: new THREE.Vector2(0, 0) },
                uCount: { value: GLYPHS.length },
                uBackground: { value: new THREE.Color(0x0b120d) },
                uFill: { value: 0.1 },
                uGlow: { value: 0 },
                uRaw: { value: 0 },
                /* How much the wash darkens round each stroke, 0 to 1. */
                uRim: { value: 0.55 },
                /* 1 for the old-terminal look; ?crt=1 turns it on. */
                uCrt: { value: crtRequested() ? 1 : 0 },
                tDepth: { value: null },
                /* How bright the scene is in the wash behind the type. */
                uWash: { value: 0.9 },
                tGlow: { value: null },
            },
        });
        this.glowMaterial = new THREE.ShaderMaterial({
            vertexShader: fullscreen,
            fragmentShader: glowShader,
            blending: THREE.NoBlending,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                tColor: { value: null },
                uCells: { value: new THREE.Vector2(1, 1) },
            },
        });
        /* Both passes' uniforms by name, made once: the objects inside are
           the materials' own, so setting a value here sets it there. */
        this.shared = { ...this.pickMaterial.uniforms, ...this.drawMaterial.uniforms };
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.pickMaterial);
        this.quad.frustumCulled = false;
        this.scene = new THREE.Scene();
        this.scene.add(this.quad);
        this.target = null;
        this.pick = null;
        this.atlas = null;
        this.tier = tierFlags("full");
        /* Whether last frame's cells still line up with this one's. */
        this.history = new HistoryTracker();
    }

    /* A quality tier from glyphs.js ASCII_TIERS: "full", "lite" or "min". */
    setTier(name) {
        this.tier = tierFlags(name);
        if (!this.tier.stable) this.history.invalidate();
    }

    /* Shared uniforms, by name, across both passes. */
    get uniforms() {
        return this.shared;
    }

    setSize({ cols, rows, cellW, cellH, offX, offY }) {
        if (!this.atlas || this.atlas.cellW !== cellW || this.atlas.cellH !== cellH) {
            if (this.atlas) this.atlas.texture.dispose();
            this.atlas = { ...buildAtlas(cellW, cellH), cellW, cellH };
        }
        if (this.target) {
            this.target.depthTexture.dispose();
            this.target.dispose();
            this.pick.dispose();
            this.pickPrev.dispose();
            this.glow.dispose();
        }
        const w = cols * SAMPLE_X;
        const h = rows * SAMPLE_Y;
        this.target = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
        });
        this.target.depthTexture = new THREE.DepthTexture(w, h);
        if (this.ghost) {
            this.ghost.depthTexture.dispose();
            this.ghost.dispose();
        }
        this.ghost = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
        this.ghost.depthTexture = new THREE.DepthTexture(w, h);
        const cells = () =>
            new THREE.WebGLRenderTarget(cols, rows, {
                minFilter: THREE.NearestFilter,
                magFilter: THREE.NearestFilter,
                depthBuffer: false,
            });
        /* Two, swapped every frame: one being written, last frame's to
           compare against. */
        this.pick = cells();
        this.pickPrev = cells();
        this.history.invalidate();
        this.glow = new THREE.WebGLRenderTarget(cols, rows, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            depthBuffer: false,
        });
        this.glowMaterial.uniforms.tColor.value = this.target.texture;
        this.glowMaterial.uniforms.uCells.value.set(cols, rows);

        const p = this.pickMaterial.uniforms;
        p.tColor.value = this.target.texture;
        p.tDepth.value = this.target.depthTexture;
        p.tGhost.value = this.ghost.depthTexture;
        p.uCells.value.set(cols, rows);
        p.uCellPx.value.set(cellW, cellH);
        const d = this.drawMaterial.uniforms;
        d.tPick.value = this.pick.texture;
        d.tGlow.value = this.glow.texture;
        d.tGlyphs.value = this.atlas.texture;
        d.tColor.value = this.target.texture;
        d.tDepth.value = this.target.depthTexture;
        d.uCells.value.set(cols, rows);
        d.uCellPx.value.set(cellW, cellH);
        d.uOffset.value.set(offX, offY);
        this.offset = { x: offX, y: offY };
    }

    /* Slide the finished picture by a few pixels, under the characters. */
    setShift(x, y) {
        if (this.offset) this.drawMaterial.uniforms.uOffset.value.set(this.offset.x + x, this.offset.y + y);
    }

    /* Draw only what is on `layer` (JR) into the ghost target, for the
       outline that shows through walls. */
    renderGhost(renderer, scene, camera, layer) {
        const mask = camera.layers.mask;
        camera.layers.set(layer);
        renderer.setRenderTarget(this.ghost);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
        camera.layers.mask = mask;
    }

    /*
     * Whether last frame's cells line up with this frame's, and if so how
     * far they slid (see history.js). A turn, a zoom, a change of camera,
     * a perspective camera on the move or a lost context and last frame's
     * cells are ignored; holding on to them would smear, or (after a
     * context comes back with empty targets) hold cells blank.
     */
    trackHistory(renderer = null) {
        const p = this.pickMaterial.uniforms;
        if (renderer) this.history.watch(renderer.domElement);
        const camera = {
            view: p.uCamToWorld.value.elements,
            /* The inverse changes whenever the projection does. */
            projection: p.uInvProj.value.elements,
            ortho: p.uOrtho.value > 0.5,
        };
        const { valid, dx, dy } = this.history.update(camera, p.uCellShift.value, this.tier.stable);
        p.uHistShift.value.set(dx, dy);
        p.uHistory.value = valid ? 1 : 0;
    }

    render(renderer) {
        this.trackHistory(renderer);
        /* Last frame's cells become the ones to compare against. */
        [this.pick, this.pickPrev] = [this.pickPrev, this.pick];
        this.pickMaterial.uniforms.tPrev.value = this.pickPrev.texture;
        this.drawMaterial.uniforms.tPick.value = this.pick.texture;
        const dither = this.pickMaterial.uniforms.uDither;
        const ditherWas = dither.value;
        if (!this.tier.dither) dither.value = 0;
        const cue = this.pickMaterial.uniforms.uDepthCue;
        const cueWas = cue.value;
        if (!this.tier.depth) cue.value = 0;
        const crt = this.drawMaterial.uniforms.uCrt;
        const crtWas = crt.value;
        if (!this.tier.crt) crt.value = 0;
        const glow = this.drawMaterial.uniforms.uGlow;
        const glowWas = glow.value;
        if (!this.tier.glow) glow.value = 0;
        this.drawCells(renderer);
        dither.value = ditherWas;
        cue.value = cueWas;
        crt.value = crtWas;
        glow.value = glowWas;
    }

    drawCells(renderer) {
        if (this.drawMaterial.uniforms.uGlow.value > 0) {
            this.quad.material = this.glowMaterial;
            renderer.setRenderTarget(this.glow);
            renderer.render(this.scene, this.camera);
        }
        this.quad.material = this.pickMaterial;
        renderer.setRenderTarget(this.pick);
        renderer.render(this.scene, this.camera);
        this.quad.material = this.drawMaterial;
        renderer.setRenderTarget(null);
        renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.history.unwatch();
        this.shapes.dispose();
        if (this.atlas) this.atlas.texture.dispose();
        if (this.target) {
            this.target.depthTexture.dispose();
            this.target.dispose();
            this.pick.dispose();
            this.pickPrev.dispose();
            this.glow.dispose();
        }
        if (this.ghost) {
            this.ghost.depthTexture.dispose();
            this.ghost.dispose();
        }
        this.glowMaterial.dispose();
        this.pickMaterial.dispose();
        this.drawMaterial.dispose();
        this.quad.geometry.dispose();
    }
}

import * as THREE from "three";

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
 * Materials still have a say. Each writes a small code into alpha naming its
 * set, and a set can limit itself to a family of characters, so water only
 * ever draws in "~-=_" and grass in strokes, whatever the shapes suggest.
 * People and creatures are their own set, drawn brighter and ringed with
 * empty cells so they never melt into what stands behind them.
 */

export const GLYPH_SETS = {
    /* 0 is the default: anything without an opinion. */
    solid: 0,
    water: 1,
    leaves: 2,
    grass: 3,
    fire: 4,
    rock: 5,
    timber: 6,
    path: 7,
    figure: 8,
    /* Things that give off light: windows, lanterns, signs. */
    light: 9,
};
const CODES = 16;

/* The alpha a material writes to select a glyph set. */
export function glyphCode(set) {
    return (set + 0.5) / CODES;
}

/* Every printable character, space first, then two solid squares for
   things that shine. */
const GLYPHS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("") + "\u25aa\u25a0";

/* The squares belong to light alone. */
const SQUARES = "\u25aa\u25a0";

/* Characters a set may draw with. Sets not listed may use any. */
const FAMILIES = {
    /* Built things draw in strokes and marks, never letters, so a wall reads
       as masonry rather than as a page of type. */
    solid: " .,:;'`\"-_=+*#%|/\\()<>^~![]{}",
    rock: " .,:;'`\"-_=+*#%@&$|/\\()<>^~!",
    light: " .:-=+*#\u25aa\u25a0",
    water: " ~-=_.,'`^:",
    leaves: " .,:;'`\"*+o%&@#^~()",
    grass: " /\\|'\",.`:;vVwWyY!il",
    fire: " *^'\".,:+xX%#&@`",
    timber: " =-_|:.'#+[]",
    path: " .,:;-_='\"`",
    /* Figures draw in symbols, not letters, so a person stands out from a
       world written in type. */
    figure: " .,:;'`\"-_=+*#%@|/\\()<>^~![]{}oO0",
};

/*
 * Flat stretches, where a cell holds no edge, draw from a ramp instead: ten
 * density levels per set, four interchangeable characters each, picked per
 * cell by a hash of where it sits. A wall then reads as a page of type
 * ("uqeq&%p") rather than one letter repeated. Index by set number.
 */
const LEVELS = 10;
const VARIANTS = 4;
const RAMPS = [
    /* solid */ ["    ", " .' ", ".,-'", ":;-:", "=:;=", "+=-=", "+*=+", "*#+*", "#%*#", "%#%#"],
    /* water */ ["    ", " .  ", ".-.,", "-~-.", "~~-~", "~=~~", "=~=~", "~=~=", "==~=", "===="],
    /* leaves */ ["    ", " .' ", ".,:'", ":;*,", "*+o;", "o*+%", "%&o*", "&%*&", "@&%&", "@@%#"],
    /* grass */ [" .  ", " .,'", ",'`.", "',/\\", "/|\\'", "/\\|\"", "\\/|v", "|/\\v", "wvWv", "WwVW"],
    /* fire */ ["    ", " .' ", ".'*.", "*+'*", "+*^*", "*%+*", "%*&*", "&%@*", "@&%@", "@@#@"],
    /* rock */ ["    ", " .' ", ".:-'", ":-=;", "=;:=", "+=-=", "*=+*", "#*%+", "%#$%", "#@%&"],
    /* timber */ ["    ", " .  ", ". -.", "-.-.", "-:-=", "=-:-", "=-=+", "+=-=", "=+=#", "#=+="],
    /* path */ ["    ", "    ", " .  ", ". . ", ".,. ", ",.:.", ":.,:", ";:.:", "=;:=", "=:=;"],
    /* figure */ ["    ", " .' ", ".:-'", ":-=;", "=+-=", "+*=+", "*o+*", "#*%o", "%#@%", "@#%@"],
    /* light */ ["    ", " .. ", ".:.:", ":-:-", "=-=+", "+=+*", "*+#*", "#\u25aa#\u25aa", "\u25aa\u25a0\u25aa\u25a0", "\u25a0\u25a0\u25a0\u25a0"],
];

/* Brightness gain per set: ground and walls stay airy, figures carry the
   picture. Index by set number. */
const GAINS = [1.25, 1.2, 1.15, 1.0, 1.4, 1.15, 1.05, 1.05, 0.9, 1.3];

const REGIONS_X = 2;
const REGIONS_Y = 3;
export const SAMPLE_X = REGIONS_X * 2;
export const SAMPLE_Y = REGIONS_Y * 2;

const FONT = `"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Courier New", monospace`;

function drawGlyph(ctx, ch, x, cellW, cellH) {
    ctx.fillText(ch, x + cellW / 2, cellH * 0.55, cellW);
}

/*
 * The atlas the second pass stamps from: one row, one cell per character,
 * drawn at the size the screen uses.
 */
export function buildAtlas(cellW, cellH) {
    const canvas = document.createElement("canvas");
    canvas.width = cellW * GLYPHS.length;
    canvas.height = cellH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `500 ${Math.round(cellH * 0.9)}px ${FONT}`;
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
   row 0 holds regions 0–3, row 1 regions 4–5, and row 2 + set is 1 where
   that set may use the character. */
function buildShapeTexture() {
    const shapes = measureGlyphs();
    const n = GLYPHS.length;
    const names = Object.keys(GLYPH_SETS);
    const rows = 2 + names.length * 2;
    const data = new Float32Array(n * rows * 4);
    shapes.forEach((s, i) => {
        const ch = GLYPHS[i];
        data.set([s[0], s[1], s[2], s[3]], i * 4);
        data.set([s[4], s[5], 0, 0], (n + i) * 4);
        names.forEach((name) => {
            const family = FAMILIES[name];
            const allowed = (family ? family.includes(ch) : !SQUARES.includes(ch)) ? 1 : 0;
            data[((2 + GLYPH_SETS[name]) * n + i) * 4] = allowed;
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
    uniform mat4 uInvProj;
    uniform mat4 uCamToWorld;

    const int COUNT = ${GLYPHS.length};
    const float CODES = ${CODES.toFixed(1)};
    const float FIGURE = ${GLYPH_SETS.figure.toFixed(1)};
    const float WATER = ${GLYPH_SETS.water.toFixed(1)};
    const float SOLID = ${GLYPH_SETS.solid.toFixed(1)};
    const float TIMBER = ${GLYPH_SETS.timber.toFixed(1)};
    const float ROCK = ${GLYPH_SETS.rock.toFixed(1)};
    const float PATH = ${GLYPH_SETS.path.toFixed(1)};
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

    float viewDepth(vec2 uv) {
        float d = texture(tDepth, uv).r;
        return (uNear * uFar) / (uFar - d * (uFar - uNear));
    }

    /* Where on the ground a point of the screen lands, in world units. */
    vec2 groundAt(vec2 uv) {
        float z = texture(tDepth, uv).r * 2.0 - 1.0;
        vec4 view = uInvProj * vec4(uv * 2.0 - 1.0, z, 1.0);
        vec4 world = uCamToWorld * vec4(view.xyz / view.w, 1.0);
        return world.xz + 0.5;
    }

    float setAt(vec2 cell) {
        vec2 c = clamp(cell, vec2(0.0), uCells - 1.0);
        ivec2 texel = ivec2(c * vec2(${SAMPLE_X}.0, ${SAMPLE_Y}.0)) + ivec2(${SAMPLE_X / 2}, ${SAMPLE_Y / 2});
        return floor(texelFetch(tColor, texel, 0).a * CODES);
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
            lum[i] = max(0.0, dot(c, vec3(0.299, 0.587, 0.114)) - 0.035) * gain;
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

        int choice = 0;
        if (spread > uEdge && peak > 0.08) {
            /* An edge runs through this cell: find the character shaped
               most like it. */
            float best = 1e9;
            for (int g = 0; g < COUNT; g++) {
                if (texelFetch(tShapes, ivec2(g, setRow), 0).r < 0.5) continue;
                vec4 a = texelFetch(tShapes, ivec2(g, 0), 0);
                vec4 b = texelFetch(tShapes, ivec2(g, 1), 0);
                vec4 da = a - vec4(lum[0], lum[1], lum[2], lum[3]) * halo;
                vec2 db = b.xy - vec2(lum[4], lum[5]) * halo;
                float e = dot(da, da) + dot(db, db);
                if (e < best) {
                    best = e;
                    choice = g;
                }
            }
        } else {
            /* Flat: a density from the ramp, a character from the hash. */
            float mean = (lum[0] + lum[1] + lum[2] + lum[3] + lum[4] + lum[5]) / 6.0 * halo;
            /* A curve on the way in: dim faces thin out to dots, so the lit
               ones and the edges stand clear of them. */
            float curve = set == FIGURE ? 1.0 : uContrast;
            float level = floor(pow(clamp(mean * uRamp, 0.0, 0.999), curve) * ${LEVELS}.0);
            /* And a ceiling, where the curve is on: a sunlit wall stays a
               page of letters rather than a slab of @ and W. */
            if (uContrast > 1.0 && set != FIGURE) level = min(level, set == WATER ? ${LEVELS - 2}.0 : ${LEVELS - 3}.0);
            float shuffle = set == WATER ? floor(uTime * 0.6) : 0.0;
            float variant = floor(hash(cell + shuffle * vec2(3.1, 1.7)) * ${VARIANTS}.0);
            choice = int(texelFetch(tShapes, ivec2(int(level * ${VARIANTS}.0 + variant), 2 + ${Object.keys(GLYPH_SETS).length} + setIndex), 0).r);
        }

        /* The scene's colour, lifted to read as ink on the dark. Figures keep
           their hue at full strength, so a purple coat stays purple rather
           than washing out to cream. */
        vec3 ink = clamp(color * 1.5 * uInk + 0.03, 0.0, 1.0);
        if (set == FIGURE) {
            float top = max(max(color.r, color.g), color.b);
            ink = clamp(color / max(top, 0.03) * (0.62 + top * 0.6), 0.0, 1.0);
        }
        float glyph = float(choice);

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
            if ((far - d) / d > limit && (d - near) < (far - d) * 0.5) {
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
        if (uJoints > 0.0 && set == PATH) {
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
                   joint takes one cell a row rather than two. */
                float reach = 0.5 * max(abs(g.x), abs(g.y));
                if (abs(g.x) + abs(g.y) > 0.4 || abs(v - floor(v + 0.5)) > reach) continue;
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

        gl_FragColor = vec4(ink, glyph / 255.0);
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

    const float CODES = ${CODES.toFixed(1)};

    /* Light spilling from windows, lanterns and fire onto what is around
       them: a soft wash behind the characters, gathered from a ring of
       samples about the cell. Only sets that shine contribute. */
    vec3 spill(vec2 cell) {
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
        return sum / 12.0;
    }

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
        float glyph = floor(pick.a * 255.0 + 0.5);
        vec2 local = fract(frag / uCellPx);
        vec2 at = vec2((glyph + local.x) / uCount, local.y);
        float mask = texture(tGlyphs, at).r;
        vec3 glow = uGlow > 0.0 ? spill(cell) * uGlow : vec3(0.0);
        vec3 base = mix(uBackground, pick.rgb * 0.5, uFill) + glow * 0.55;
        gl_FragColor = vec4(mix(base, min(pick.rgb + glow * 0.35, 1.0), mask), 1.0);
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
                uCamToWorld: { value: new THREE.Matrix4() },
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
            },
        });
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.pickMaterial);
        this.quad.frustumCulled = false;
        this.scene = new THREE.Scene();
        this.scene.add(this.quad);
        this.target = null;
        this.pick = null;
        this.atlas = null;
    }

    /* Shared uniforms, by name, across both passes. */
    get uniforms() {
        return { ...this.pickMaterial.uniforms, ...this.drawMaterial.uniforms };
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
        }
        const w = cols * SAMPLE_X;
        const h = rows * SAMPLE_Y;
        this.target = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
        });
        this.target.depthTexture = new THREE.DepthTexture(w, h);
        this.pick = new THREE.WebGLRenderTarget(cols, rows, {
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            depthBuffer: false,
        });

        const p = this.pickMaterial.uniforms;
        p.tColor.value = this.target.texture;
        p.tDepth.value = this.target.depthTexture;
        p.uCells.value.set(cols, rows);
        p.uCellPx.value.set(cellW, cellH);
        const d = this.drawMaterial.uniforms;
        d.tPick.value = this.pick.texture;
        d.tGlyphs.value = this.atlas.texture;
        d.tColor.value = this.target.texture;
        d.uCells.value.set(cols, rows);
        d.uCellPx.value.set(cellW, cellH);
        d.uOffset.value.set(offX, offY);
    }

    render(renderer) {
        this.quad.material = this.pickMaterial;
        renderer.setRenderTarget(this.pick);
        renderer.render(this.scene, this.camera);
        this.quad.material = this.drawMaterial;
        renderer.setRenderTarget(null);
        renderer.render(this.scene, this.camera);
    }

    dispose() {
        this.shapes.dispose();
        if (this.atlas) this.atlas.texture.dispose();
        if (this.target) {
            this.target.depthTexture.dispose();
            this.target.dispose();
            this.pick.dispose();
        }
        this.pickMaterial.dispose();
        this.drawMaterial.dispose();
        this.quad.geometry.dispose();
    }
}

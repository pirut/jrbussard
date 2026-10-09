import * as THREE from "three";

/*
 * Turning a 3D render into characters.
 *
 * The scene is drawn into a small offscreen target, two texels per character
 * cell on each side, so sampling a cell's centre with linear filtering is
 * exactly the average of its four texels. A full-screen pass then decides, for
 * every cell, which character stands in for that patch of picture:
 *
 *   - Brightness picks a density level, sparse to dense.
 *   - Each level has several characters of about the same weight, and every
 *     cell picks one by a hash of where it sits. A wall then reads as a page
 *     of text ("uqeq&%p") rather than one letter repeated, which is what makes
 *     it look like type and not like a dithered picture.
 *   - Which family of characters depends on the material. Each material
 *     writes a small code into the alpha channel: water draws in tildes,
 *     grass in strokes, fire in stars, stone in letters.
 *   - Sharp jumps in depth become line characters along the edge, so thin
 *     things like grass blades and the edges of roofs keep their direction.
 *
 * Colour is the scene's own, brightened a little: the dark stays dark.
 */

export const GLYPH_SETS = {
    /* 0 is the default: people, monsters, anything without an opinion. */
    solid: 0,
    water: 1,
    leaves: 2,
    grass: 3,
    fire: 4,
    rock: 5,
    timber: 6,
    path: 7,
    /* People and creatures: brighter ink, and a dark gap around them so a
       figure never melts into the wall behind it. */
    figure: 8,
};
const CODES = 16;

/*
 * For each set, ten density levels of four interchangeable characters.
 * Level 0 is empty; level 9 is as heavy as type gets.
 */
const LEVELS = 10;
const VARIANTS = 4;
const RAMPS = [
    /* solid */ ["    ", " .' ", ".,-'", ":;~^", "=+cr", "uvxz", "aeoq", "pdbk", "%&$8", "#@WM"],
    /* water */ ["    ", " .  ", ".-.,", "-~-.", "~~-~", "~=~~", "=~≈~", "≈=≈~", "≈≈=≈", "≈≈≈≈"],
    /* leaves */ ["    ", " .' ", ".,:'", ":;*,", "*+o;", "oca%", "%&o8", "&%8B", "@&B%", "@@B#"],
    /* grass */ [" .  ", " .,'", ",'`.", "',/\\", "/|\\'", "/\\|\"", "\\/|v", "|/\\v", "wvWv", "WwVW"],
    /* fire */ ["    ", " .' ", ".'*.", "*+'*", "+*^*", "*%+*", "%*&*", "&%@*", "@&%@", "@@#@"],
    /* rock */ ["    ", " .' ", ".:-'", ":-=;", "=ncr", "nuqe", "dbpq", "8$%&", "#%$B", "M#@W"],
    /* timber: boards read as runs of = and - rather than a page of letters */
    /* timber */ ["    ", " .- ", ".-:-", "-=:-", "=-=:", "==+=", "=#=+", "#=#=", "##=#", "#H##"],
    /* path */ ["    ", " .  ", ". .,", ".,.:", ":.,:", "::;.", ";:=:", "=;:=", "==#=", "#=##"],
    /* figure */ ["    ", " .' ", ".:-'", ":;=+", "=+*o", "oaec", "eaqd", "dbpq", "&%$8", "@#WM"],
];
/* How hard each set leans toward its dense end. Ground and walls stay
   airy so the things moving across them carry the picture. */
const GAINS = [2.2, 2.2, 2.0, 1.7, 2.6, 1.9, 1.75, 1.8, 2.9];
const EDGES = "|-/\\_";

/* The alpha a material writes to select a glyph set. */
export function glyphCode(set) {
    return (set + 0.5) / CODES;
}

/* One row per set plus one for edges, each glyph exactly one cell. */
export function buildAtlas(cellW, cellH) {
    const canvas = document.createElement("canvas");
    const cols = LEVELS * VARIANTS;
    const rows = RAMPS.length + 1;
    canvas.width = cellW * cols;
    canvas.height = cellH * rows;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = Math.round(cellH * 0.92);
    ctx.font = `500 ${size}px "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Courier New", monospace`;
    const draw = (ch, col, row) => {
        ctx.fillText(ch, (col + 0.5) * cellW, (row + 0.55) * cellH, cellW);
    };
    RAMPS.forEach((levels, row) => {
        levels.forEach((variants, level) => {
            Array.from(variants).forEach((ch, v) => draw(ch, level * VARIANTS + v, row));
        });
    });
    Array.from(EDGES).forEach((ch, col) => draw(ch, col, RAMPS.length));

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.NoColorSpace;
    return { texture, cols, rows };
}

const vertexShader = /* glsl */ `
    void main() {
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    precision highp float;

    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform sampler2D tGlyphs;
    uniform vec2 uCells;
    uniform vec2 uCellPx;
    uniform vec2 uOffset;
    uniform vec2 uAtlas;
    uniform vec3 uBackground;
    uniform float uNear;
    uniform float uFar;
    uniform float uEdge;
    uniform float uFill;
    uniform float uGain;
    uniform float uRaw;
    uniform float uShuffle;
    uniform float uTime;
    uniform float uRain;
    uniform vec3 uRainColor;
    uniform float uStars;
    uniform float uClouds;
    uniform vec3 uCloudColor;
    uniform float uSkyShift;

    const float LEVELS = ${LEVELS.toFixed(1)};
    const float VARIANTS = ${VARIANTS.toFixed(1)};
    const float CODES = ${CODES.toFixed(1)};
    const float FIGURE = ${GLYPH_SETS.figure.toFixed(1)};
    const float GAINS[${GAINS.length}] = float[${GAINS.length}](${GAINS.map((g) => g.toFixed(2)).join(", ")});

    float viewDepth(vec2 uv) {
        float d = texture2D(tDepth, uv).r;
        return (uNear * uFar) / (uFar - d * (uFar - uNear));
    }

    vec3 toSrgb(vec3 c) {
        return pow(max(c, 0.0), vec3(1.0 / 2.2));
    }

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

    float setAt(vec2 cell) {
        vec2 c = clamp(cell, vec2(0.0), uCells - 1.0);
        return floor(texelFetch(tColor, ivec2(c * 2.0) + ivec2(1, 1), 0).a * CODES);
    }

    /*
     * Rain is drawn in characters too, straight onto the grid: each slanted
     * lane of cells may carry a drop, a short run of / falling down it.
     */
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
        vec2 frag = gl_FragCoord.xy - uOffset;
        vec2 cell = floor(frag / uCellPx);
        if (frag.x < 0.0 || frag.y < 0.0 || cell.x >= uCells.x || cell.y >= uCells.y) {
            gl_FragColor = vec4(uBackground, 1.0);
            return;
        }
        vec2 local = fract(frag / uCellPx);
        vec2 uv = (cell + 0.5) / uCells;

        if (uRaw > 0.5) {
            vec2 rawUv = frag / (uCells * uCellPx);
            gl_FragColor = vec4(toSrgb(texture2D(tColor, rawUv).rgb), 1.0);
            return;
        }

        vec3 color = toSrgb(texture2D(tColor, uv).rgb);
        /* The glyph set is a code, not a quantity: read one texel rather than
           an average that could land between two sets. */
        float set = setAt(cell);
        float luma = dot(color, vec3(0.299, 0.587, 0.114));

        /* Silhouettes: how sharply depth changes across this cell. */
        vec2 step = 1.0 / uCells;
        float d = viewDepth(uv);
        float dl = viewDepth(uv - vec2(step.x, 0.0));
        float dr = viewDepth(uv + vec2(step.x, 0.0));
        float dd = viewDepth(uv - vec2(0.0, step.y));
        float du = viewDepth(uv + vec2(0.0, step.y));
        /* Only the near side of a jump draws the line, so outlines hug the
           object instead of landing on whatever is behind it. */
        vec2 grad = vec2(dr - dl, du - dd);
        float nearer = min(min(dl, dr), min(dd, du));
        float jump = length(grad) / max(d, 0.001);
        bool isEdge = jump > uEdge && d <= nearer + 0.02 * d && set != 1.0 && luma > 0.05;

        /* Background cells touching a figure that stands in front of them
           go quiet, which outlines the figure in empty space. */
        float halo = 1.0;
        if (set != FIGURE) {
            if ((setAt(cell + vec2(1.0, 0.0)) == FIGURE && dr < d) ||
                (setAt(cell - vec2(1.0, 0.0)) == FIGURE && dl < d) ||
                (setAt(cell + vec2(0.0, 1.0)) == FIGURE && du < d) ||
                (setAt(cell - vec2(0.0, 1.0)) == FIGURE && dd < d)) {
                halo = 0.18;
                isEdge = false;
            }
        }

        /* Open sky: stars at night and slow bands of cloud, pinned to the
           heading so they wheel past as the camera turns. */
        bool sky = texture2D(tDepth, uv).r >= 0.99999;
        vec3 skyInk = vec3(0.0);
        vec2 skyGlyph = vec2(-1.0);
        if (sky) {
            vec2 sc = vec2(cell.x + uSkyShift, cell.y);
            float clouds = noise(vec2(sc.x * 0.045 + uTime * 0.12, sc.y * 0.2)) * 0.65
                         + noise(vec2(sc.x * 0.11 - uTime * 0.05, sc.y * 0.45)) * 0.35;
            float cover = clouds - (0.66 - uClouds * 0.3);
            float h = hash(floor(sc));
            if (cover > 0.0) {
                float level = 1.0 + floor(clamp(cover * 9.0, 0.0, 2.99));
                skyGlyph = vec2(level * VARIANTS + floor(hash(sc + 9.1) * VARIANTS), 1.0);
                skyInk = uCloudColor * (0.55 + cover * 1.5);
            } else if (h < 0.022 * uStars) {
                float twinkle = 0.55 + 0.45 * sin(uTime * (1.3 + h * 90.0) + h * 400.0);
                float level = 1.0 + floor(hash(sc + 4.7) * 2.6);
                skyGlyph = vec2(level * VARIANTS + floor(hash(sc + 2.3) * VARIANTS), 0.0);
                skyInk = vec3(0.78, 0.84, 1.0) * twinkle * uStars;
            }
        }

        vec2 glyph;
        if (skyGlyph.x >= 0.0) {
            glyph = skyGlyph;
        } else if (isEdge) {
            /* The edge runs perpendicular to the gradient. */
            float angle = atan(grad.y * uCellPx.y, grad.x * uCellPx.x);
            float a = mod(angle + 3.14159265, 3.14159265);
            float index;
            if (a < 0.3927 || a >= 2.7489) index = 0.0;            /* | */
            else if (a < 1.1781) index = 3.0;                       /* \\ */
            else if (a < 1.9635) index = grad.y > 0.0 ? 4.0 : 1.0;  /* _ or - */
            else index = 2.0;                                       /* / */
            glyph = vec2(index, uAtlas.y - 1.0);
        } else {
            float gain = GAINS[int(clamp(set, 0.0, ${GAINS.length - 1}.0))] * uGain / 2.2;
            float level = floor(clamp(luma * gain, 0.0, 0.999) * LEVELS);
            /* Which of the level's characters: fixed per cell, reshuffled
               now and then so stone and water seem to murmur. */
            float variant = floor(hash(cell + floor(uShuffle) * vec2(3.1, 1.7)) * VARIANTS);
            glyph = vec2(level * VARIANTS + variant, set);
        }

        /* Atlas rows run top to bottom; the canvas texture is flipped, so
           row 0 sits at the top of texture space. */
        vec2 atlasUv = vec2(
            (glyph.x + local.x) / uAtlas.x,
            1.0 - (glyph.y + 1.0 - local.y) / uAtlas.y
        );
        float mask = texture2D(tGlyphs, atlasUv).r * halo;

        /* The scene's colour, lifted enough to read as ink on the dark.
           Figures get more of a lift than the world around them. */
        vec3 ink = set == FIGURE ? clamp(color * 1.95 + 0.07, 0.0, 1.0) : clamp(color * 1.55 + 0.02, 0.0, 1.0);
        if (skyGlyph.x >= 0.0) ink = skyInk;
        vec3 base = mix(uBackground, color, uFill * halo);
        vec3 outColor = mix(base, ink, mask);

        float drop = uRain > 0.0 ? rainAt(cell) : 0.0;
        if (drop > 0.0) {
            vec2 rainUv = vec2((2.0 + local.x) / uAtlas.x, 1.0 - (uAtlas.y - local.y) / uAtlas.y);
            float rainMask = texture2D(tGlyphs, rainUv).r;
            outColor = mix(outColor, uRainColor, rainMask * drop * 0.85);
        }
        gl_FragColor = vec4(outColor, 1.0);
    }
`;

export function createAsciiMaterial(atlas) {
    return new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        uniforms: {
            tColor: { value: null },
            tDepth: { value: null },
            tGlyphs: { value: atlas.texture },
            uCells: { value: new THREE.Vector2(1, 1) },
            uCellPx: { value: new THREE.Vector2(8, 14) },
            uOffset: { value: new THREE.Vector2(0, 0) },
            uAtlas: { value: new THREE.Vector2(atlas.cols, atlas.rows) },
            uBackground: { value: new THREE.Color(0x0b120d) },
            uNear: { value: 0.1 },
            uFar: { value: 200 },
            uEdge: { value: 0.14 },
            uFill: { value: 0.08 },
            uGain: { value: 2.2 },
            uRaw: { value: 0 },
            uShuffle: { value: 0 },
            uTime: { value: 0 },
            uRain: { value: 0 },
            uRainColor: { value: new THREE.Color(0x9fb8d8) },
            uStars: { value: 0 },
            uClouds: { value: 0 },
            uCloudColor: { value: new THREE.Color(0x2a3550) },
            uSkyShift: { value: 0 },
        },
    });
}

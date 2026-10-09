import * as THREE from "three";

/*
 * Turning a 3D render into characters.
 *
 * The scene is drawn into a small offscreen target, two texels per character
 * cell on each side, so sampling a cell's centre with linear filtering is
 * exactly the average of its four texels. A full-screen pass then decides, for
 * every cell, which character stands in for that patch of picture:
 *
 *   - Silhouettes come from the depth buffer. Where depth jumps between
 *     neighbouring cells the cell gets a line character oriented along the
 *     edge (| - / \ _), so a model reads as drawn rather than dithered.
 *   - Everywhere else brightness picks a glyph from a ramp, sparse to dense.
 *   - Which ramp depends on the material. Each material writes a small code
 *     into the alpha channel: water draws in tildes, leaves in &, grass in
 *     commas, fire in stars. The picture stays one image, but a tree still
 *     looks like the tree it was in the old flat field.
 *
 * Colour is the scene's own, lifted so the glyph carries brightness and the
 * hue stays readable even in the dark.
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
};

/* Sparse to dense. Each row must be the same length. */
const RAMPS = [
    " .:-=+*o#%@",
    " .-~~~~=≈≈≈",
    " .:;*%%&&@@",
    " ..,,,';;\"vW",
    " .'*+*#@@@@",
    " .:^^nAAM#M",
    " .-=+=#HH#H",
    " ....:::==#",
];
const EDGES = "|-/\\_";
const RAMP_LENGTH = RAMPS[0].length;

/* The alpha a material writes to select a glyph set. */
export function glyphCode(set) {
    return (set + 0.5) / 8;
}

/* One row per ramp plus one for edges, each glyph exactly one cell. */
export function buildAtlas(cellW, cellH) {
    const canvas = document.createElement("canvas");
    const cols = RAMP_LENGTH;
    const rows = RAMPS.length + 1;
    canvas.width = cellW * cols;
    canvas.height = cellH * rows;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const size = Math.round(cellH * 0.86);
    ctx.font = `600 ${size}px "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Courier New", monospace`;
    const draw = (ch, col, row) => {
        ctx.fillText(ch, (col + 0.5) * cellW, (row + 0.54) * cellH, cellW);
    };
    RAMPS.forEach((ramp, row) => {
        Array.from(ramp).forEach((ch, col) => draw(ch, col, row));
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
    uniform float uRaw;

    float viewDepth(vec2 uv) {
        float d = texture2D(tDepth, uv).r;
        return (uNear * uFar) / (uFar - d * (uFar - uNear));
    }

    vec3 toSrgb(vec3 c) {
        return pow(max(c, 0.0), vec3(1.0 / 2.2));
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

        vec4 sampleColor = texture2D(tColor, uv);
        vec3 color = toSrgb(sampleColor.rgb);
        /* The glyph set is a code, not a quantity: read one texel rather than
           an average that could land between two sets. */
        float code = texelFetch(tColor, ivec2(cell * 2.0) + ivec2(1, 1), 0).a;
        float set = floor(code * 8.0);
        float luma = dot(color, vec3(0.299, 0.587, 0.114));

        /* Silhouettes: how sharply depth changes across this cell. */
        vec2 step = 1.0 / uCells;
        float d = viewDepth(uv);
        float dl = viewDepth(uv - vec2(step.x, 0.0));
        float dr = viewDepth(uv + vec2(step.x, 0.0));
        float dd = viewDepth(uv - vec2(0.0, step.y));
        float du = viewDepth(uv + vec2(0.0, step.y));
        /* Only the near side of a jump draws the line, so outlines hug the
           object instead of landing on the ground behind it. */
        vec2 grad = vec2(dr - dl, du - dd);
        float nearer = min(min(dl, dr), min(dd, du));
        float jump = length(grad) / max(d, 0.001);
        bool isEdge = jump > uEdge && d <= nearer + 0.02 * d && set != 1.0 && luma > 0.03;

        vec2 glyph;
        if (isEdge) {
            /* The edge runs perpendicular to the gradient. */
            float angle = atan(grad.y * uCellPx.y, grad.x * uCellPx.x);
            float a = mod(angle + 3.14159265, 3.14159265);
            float index;
            if (a < 0.3927 || a >= 2.7489) index = 0.0;       /* | */
            else if (a < 1.1781) index = 3.0;                  /* \\ */
            else if (a < 1.9635) index = grad.y > 0.0 ? 4.0 : 1.0; /* _ or - */
            else index = 2.0;                                  /* / */
            glyph = vec2(index, uAtlas.y - 1.0);
        } else {
            /* A little contrast, so open ground stays sparse and the
               things standing on it come out dense. */
            float level = clamp((luma - 0.05) * 1.45, 0.0, 0.999);
            glyph = vec2(floor(level * uAtlas.x), set);
        }

        /* Atlas rows run top to bottom; the canvas texture is flipped, so
           row 0 sits at the top of texture space. */
        vec2 atlasUv = vec2(
            (glyph.x + local.x) / uAtlas.x,
            1.0 - (glyph.y + 1.0 - local.y) / uAtlas.y
        );
        float mask = texture2D(tGlyphs, atlasUv).r;

        /* Keep the hue, lift the value: the glyph already says how bright. */
        float peak = max(max(color.r, color.g), max(color.b, 0.0001));
        vec3 hue = color / peak;
        vec3 ink = hue * mix(0.42, 1.0, clamp(peak * 1.25, 0.0, 1.0));
        if (isEdge) ink = hue * mix(0.55, 1.0, clamp(peak * 1.4, 0.0, 1.0));

        vec3 base = mix(uBackground, color, uFill);
        gl_FragColor = vec4(mix(base, ink, mask), 1.0);
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
            uEdge: { value: 0.09 },
            uFill: { value: 0.1 },
            uRaw: { value: 0 },
        },
    });
}

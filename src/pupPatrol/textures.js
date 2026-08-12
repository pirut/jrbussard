/*
 * Every texture in the game is drawn into a canvas at load time. Nothing is
 * fetched: the whole thing has to survive being a route on a static site, and
 * a handful of procedural canvases cost less than one downloaded atlas.
 */

import * as THREE from "three";

function canvas(size, height) {
    const el = document.createElement("canvas");
    el.width = size;
    el.height = height || size;
    return { el, ctx: el.getContext("2d") };
}

function finish(el, { repeat = 1, aniso = 4, srgb = true } = {}) {
    const tex = new THREE.CanvasTexture(el);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = aniso;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/* Value noise on a canvas, tileable, several octaves deep. Used anywhere a
   surface needs to stop being perfectly even — which is everywhere. */
function noiseCanvas(size, octaves, contrast, seed) {
    const { el, ctx } = canvas(size);
    const img = ctx.createImageData(size, size);
    const layers = [];

    let s = seed;
    const rand = () => {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };

    for (let o = 0; o < octaves; o += 1) {
        const cells = 4 << o;
        const grid = new Float32Array(cells * cells);
        for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
        layers.push({ cells, grid, amplitude: 1 / (1 << o) });
    }

    let total = 0;
    layers.forEach((l) => {
        total += l.amplitude;
    });

    const smooth = (t) => t * t * (3 - 2 * t);

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            let value = 0;
            for (let o = 0; o < layers.length; o += 1) {
                const { cells, grid, amplitude } = layers[o];
                const fx = (x / size) * cells;
                const fy = (y / size) * cells;
                const x0 = Math.floor(fx);
                const y0 = Math.floor(fy);
                const tx = smooth(fx - x0);
                const ty = smooth(fy - y0);
                const i00 = (y0 % cells) * cells + (x0 % cells);
                const i10 = (y0 % cells) * cells + ((x0 + 1) % cells);
                const i01 = ((y0 + 1) % cells) * cells + (x0 % cells);
                const i11 = ((y0 + 1) % cells) * cells + ((x0 + 1) % cells);
                const a = grid[i00] + (grid[i10] - grid[i00]) * tx;
                const b = grid[i01] + (grid[i11] - grid[i01]) * tx;
                value += (a + (b - a) * ty) * amplitude;
            }
            value /= total;
            value = 0.5 + (value - 0.5) * contrast;
            const n = Math.max(0, Math.min(255, Math.round(value * 255)));
            const i = (y * size + x) * 4;
            img.data[i] = n;
            img.data[i + 1] = n;
            img.data[i + 2] = n;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return el;
}

/* Grain to break up flat ground. Kept greyscale and multiplied over vertex
   colour so one texture serves grass, sand, rock and snow alike. */
export function makeGroundGrain(size = 256) {
    return finish(noiseCanvas(size, 5, 0.82, 1337), { repeat: 1, aniso: 8, srgb: false });
}

/* The close-up layer: a second, much finer noise that only shows within a few
   dozen metres. It is what stops the ground turning into a smooth painted
   plane the moment you look down at your own wheels. */
export function makeGroundDetail(size = 256) {
    const el = noiseCanvas(size, 5, 0.72, 90210);
    return finish(el, { repeat: 1, aniso: 8, srgb: false });
}

/* Tarmac with a dashed centre line running along V. */
export function makeRoadTexture(size = 512) {
    const { el, ctx } = canvas(size);
    ctx.fillStyle = "#4a4a53";
    ctx.fillRect(0, 0, size, size);

    /* Aggregate: thousands of chips of slightly different grey, which is what
       a road surface actually is close up. */
    for (let i = 0; i < 26000; i += 1) {
        const g = 54 + Math.random() * 52;
        ctx.fillStyle = `rgba(${g},${g},${g + 7},${0.2 + Math.random() * 0.42})`;
        const r = 0.6 + Math.random() * 2.2;
        ctx.beginPath();
        ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2);
        ctx.fill();
    }

    /* Patched repairs and a darker strip down each wheel track, where the
       surface is polished by everything that has driven along it. */
    for (const track of [0.31, 0.69]) {
        const g = ctx.createLinearGradient((track - 0.11) * size, 0, (track + 0.11) * size, 0);
        g.addColorStop(0, "rgba(24,24,28,0)");
        g.addColorStop(0.5, "rgba(24,24,28,0.2)");
        g.addColorStop(1, "rgba(24,24,28,0)");
        ctx.fillStyle = g;
        ctx.fillRect((track - 0.11) * size, 0, size * 0.22, size);
    }

    /* Kerb-side wear. */
    const edge = ctx.createLinearGradient(0, 0, size, 0);
    edge.addColorStop(0, "rgba(28,28,32,0.62)");
    edge.addColorStop(0.13, "rgba(28,28,32,0)");
    edge.addColorStop(0.87, "rgba(28,28,32,0)");
    edge.addColorStop(1, "rgba(28,28,32,0.62)");
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, size, size);

    /* Markings, painted slightly translucent so the aggregate shows through
       them the way worn road paint does. */
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = "#f4f4f2";
    ctx.fillRect(size * 0.072, 0, size * 0.032, size);
    ctx.fillRect(size * 0.896, 0, size * 0.032, size);

    ctx.fillStyle = "#ffd94a";
    const dash = size * 0.22;
    for (let y = 0; y < size; y += dash * 2) ctx.fillRect(size * 0.484, y, size * 0.032, dash);
    ctx.globalAlpha = 1;

    return finish(el, { repeat: 1, aniso: 16 });
}

/* One sprite sheet cell: a soft round blob, used for dust, smoke and spray. */
export function makePuffTexture(size = 128) {
    const { el, ctx } = canvas(size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.66)");
    g.addColorStop(0.72, "rgba(255,255,255,0.2)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/* A tuft of grass blades, alpha-cut. */
export function makeGrassTuft(size = 128) {
    const { el, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 34; i += 1) {
        const x = size * (0.12 + Math.random() * 0.76);
        const h = size * (0.36 + Math.random() * 0.6);
        const lean = (Math.random() - 0.5) * size * 0.34;
        const w = size * 0.032;
        const shade = 118 + Math.random() * 84;
        /* Darker at the root, sunlit at the tip. Not *much* darker, and pitched
           to sit on the same green as the terrain underneath: a tuft shaded
           like a real blade of grass reads as a black spike against bright
           ground, because it is two pixels wide. */
        const grad = ctx.createLinearGradient(x, size, x + lean, size - h);
        grad.addColorStop(0, `rgb(${Math.round(shade * 0.62)},${Math.round(shade * 1.02)},${Math.round(shade * 0.44)})`);
        grad.addColorStop(1, `rgb(${Math.round(shade * 0.98)},${Math.round(shade * 1.42)},${Math.round(shade * 0.6)})`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x - w, size);
        ctx.quadraticCurveTo(x - w * 0.5 + lean * 0.5, size - h * 0.5, x + lean, size - h);
        ctx.quadraticCurveTo(x + w * 0.6 + lean * 0.5, size - h * 0.5, x + w, size);
        ctx.closePath();
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/* Big soft cloud blob for the sky. Drawn with a lit top and a shaded base so
   it has a direction rather than reading as a smudge. */
export function makeCloudTexture(size = 512) {
    const { el, ctx } = canvas(size, size / 2);
    const h = size / 2;
    ctx.clearRect(0, 0, size, h);

    const puff = (cx, cy, r, top, bottom) => {
        const g = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
        g.addColorStop(0, top);
        g.addColorStop(0.55, bottom);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    };

    /* Shaded underside first, then the sunlit crowns on top of it. */
    const blobs = 20;
    for (let i = 0; i < blobs; i += 1) {
        const t = i / blobs;
        const cx = size * (0.14 + t * 0.72 + (Math.random() - 0.5) * 0.06);
        const cy = h * (0.68 - Math.sin(t * Math.PI) * 0.14 + (Math.random() - 0.5) * 0.12);
        const r = h * (0.16 + Math.sin(t * Math.PI) * 0.2 + Math.random() * 0.06);
        puff(cx, cy, r, "rgba(206,222,238,0.82)", "rgba(190,208,228,0.4)");
    }
    for (let i = 0; i < blobs; i += 1) {
        const t = i / blobs;
        const cx = size * (0.16 + t * 0.68 + (Math.random() - 0.5) * 0.07);
        const cy = h * (0.52 - Math.sin(t * Math.PI) * 0.22 + (Math.random() - 0.5) * 0.09);
        const r = h * (0.13 + Math.sin(t * Math.PI) * 0.19 + Math.random() * 0.05);
        puff(cx, cy, r, "rgba(255,255,255,0.98)", "rgba(248,252,255,0.5)");
    }

    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/* Water normals: several sets of ripples that scroll past each other. Built as
   a height field first and then differenced, so the normals are consistent
   with a surface that could actually exist. */
export function makeWaterNormal(size = 256) {
    const { el, ctx } = canvas(size);
    const img = ctx.createImageData(size, size);
    const height = new Float32Array(size * size);

    const waves = [
        { fx: 3, fz: 1, amp: 1.0, phase: 0 },
        { fx: -2, fz: 4, amp: 0.62, phase: 1.7 },
        { fx: 5, fz: -3, amp: 0.34, phase: 0.4 },
        { fx: 7, fz: 6, amp: 0.18, phase: 2.9 },
    ];

    for (let y = 0; y < size; y += 1) {
        const v = (y / size) * Math.PI * 2;
        for (let x = 0; x < size; x += 1) {
            const u = (x / size) * Math.PI * 2;
            let h = 0;
            for (let i = 0; i < waves.length; i += 1) {
                const w = waves[i];
                h += Math.sin(u * w.fx + v * w.fz + w.phase) * w.amp;
            }
            height[y * size + x] = h;
        }
    }

    const strength = 0.28;
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const l = height[y * size + ((x - 1 + size) % size)];
            const r = height[y * size + ((x + 1) % size)];
            const d = height[((y - 1 + size) % size) * size + x];
            const u = height[((y + 1) % size) * size + x];
            const nx = (l - r) * strength;
            const nz = (d - u) * strength;
            const len = Math.hypot(nx, nz, 1);
            const i = (y * size + x) * 4;
            img.data[i] = (nx / len) * 127 + 128;
            img.data[i + 1] = (1 / len) * 127 + 128;
            img.data[i + 2] = (nz / len) * 127 + 128;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return finish(el, { repeat: 1, srgb: false, aniso: 8 });
}

/* Wooden plank face, for jetties, fences and the bridge deck. */
export function makeWoodTexture(size = 256) {
    const { el, ctx } = canvas(size);
    ctx.fillStyle = "#a9773f";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 5; i += 1) {
        const y = (i / 5) * size;
        ctx.fillStyle = `rgba(${120 + Math.random() * 40},${80 + Math.random() * 30},${38},0.35)`;
        ctx.fillRect(0, y, size, size / 5 - 1);
        ctx.fillStyle = "rgba(60,36,16,0.55)";
        ctx.fillRect(0, y + size / 5 - 3, size, 3);
    }
    /* Grain lines and a few knots. */
    for (let i = 0; i < 1800; i += 1) {
        ctx.fillStyle = `rgba(90,58,26,${Math.random() * 0.25})`;
        ctx.fillRect(Math.random() * size, Math.random() * size, 10 + Math.random() * 36, 1);
    }
    for (let i = 0; i < 6; i += 1) {
        const kx = Math.random() * size;
        const ky = Math.random() * size;
        const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, 4 + Math.random() * 5);
        g.addColorStop(0, "rgba(58,34,14,0.7)");
        g.addColorStop(1, "rgba(58,34,14,0)");
        ctx.fillStyle = g;
        ctx.fillRect(kx - 12, ky - 12, 24, 24);
    }
    return finish(el, { repeat: 1, aniso: 8 });
}

/* A soft round shadow, dropped under things that are too small to be worth a
   shadow map texel but look pasted on without one. */
export function makeBlobShadow(size = 128) {
    const { el, ctx } = canvas(size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.5, "rgba(0,0,0,0.28)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(el);
    return tex;
}

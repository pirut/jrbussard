/*
 * Every texture in the game is drawn into a canvas at load time. Nothing is
 * fetched: the whole thing has to survive being a route on a static site, and
 * a handful of procedural canvases cost less than one downloaded atlas.
 */

import * as THREE from "three";

function canvas(size) {
    const el = document.createElement("canvas");
    el.width = size;
    el.height = size;
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

/* Grain to break up flat ground. Kept greyscale and multiplied over vertex
   colour so one texture serves grass, sand, rock and snow alike. */
export function makeGroundGrain(size = 256) {
    const { el, ctx } = canvas(size);
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i += 1) {
        const n = 168 + Math.random() * 74;
        img.data[i * 4] = n;
        img.data[i * 4 + 1] = n;
        img.data[i * 4 + 2] = n;
        img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    /* Blur it a little by drawing itself back scaled, so the grain reads as
       clumps of ground rather than television static. */
    ctx.globalAlpha = 0.55;
    ctx.drawImage(el, 0, 0, size, size, -2, -2, size + 4, size + 4);
    ctx.globalAlpha = 1;
    return finish(el, { repeat: 1, srgb: false });
}

/* Tarmac with a dashed centre line running along V. */
export function makeRoadTexture(size = 256) {
    const { el, ctx } = canvas(size);
    ctx.fillStyle = "#4c4c55";
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 5200; i += 1) {
        const g = 60 + Math.random() * 46;
        ctx.fillStyle = `rgba(${g},${g},${g + 6},${0.25 + Math.random() * 0.4})`;
        ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }

    /* Kerb-side wear. */
    const edge = ctx.createLinearGradient(0, 0, size, 0);
    edge.addColorStop(0, "rgba(30,30,34,0.55)");
    edge.addColorStop(0.14, "rgba(30,30,34,0)");
    edge.addColorStop(0.86, "rgba(30,30,34,0)");
    edge.addColorStop(1, "rgba(30,30,34,0.55)");
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "#f2f2f2";
    ctx.fillRect(size * 0.075, 0, size * 0.035, size);
    ctx.fillRect(size * 0.89, 0, size * 0.035, size);

    ctx.fillStyle = "#ffd94a";
    const dash = size * 0.22;
    for (let y = 0; y < size; y += dash * 2) ctx.fillRect(size * 0.485, y, size * 0.03, dash);

    return finish(el, { repeat: 1, aniso: 8 });
}

/* One sprite sheet cell: a soft round blob, used for dust, smoke and spray. */
export function makePuffTexture(size = 128) {
    const { el, ctx } = canvas(size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.62)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/* A tuft of grass blades, alpha-cut. */
export function makeGrassTuft(size = 64) {
    const { el, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < 13; i += 1) {
        const x = size * (0.14 + Math.random() * 0.72);
        const h = size * (0.4 + Math.random() * 0.56);
        const lean = (Math.random() - 0.5) * size * 0.3;
        const w = size * 0.05;
        const shade = 96 + Math.random() * 78;
        ctx.fillStyle = `rgb(${Math.round(shade * 0.62)},${Math.round(shade)},${Math.round(shade * 0.42)})`;
        ctx.beginPath();
        ctx.moveTo(x - w, size);
        ctx.quadraticCurveTo(x - w * 0.5 + lean * 0.5, size - h * 0.5, x + lean, size - h);
        ctx.quadraticCurveTo(x + w * 0.6 + lean * 0.5, size - h * 0.5, x + w, size);
        ctx.closePath();
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/* Big soft cloud blob for the sky. */
export function makeCloudTexture(size = 256) {
    const { el, ctx } = canvas(size);
    ctx.clearRect(0, 0, size, size);
    const blobs = 16;
    for (let i = 0; i < blobs; i += 1) {
        const t = i / blobs;
        const cx = size * (0.16 + t * 0.68 + (Math.random() - 0.5) * 0.08);
        const cy = size * (0.56 - Math.sin(t * Math.PI) * 0.2 + (Math.random() - 0.5) * 0.1);
        const r = size * (0.09 + Math.sin(t * Math.PI) * 0.13 + Math.random() * 0.04);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, "rgba(255,255,255,0.95)");
        g.addColorStop(0.6, "rgba(255,255,255,0.5)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }
    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

/* Water normals: two sets of ripples that scroll past each other. */
export function makeWaterNormal(size = 256) {
    const { el, ctx } = canvas(size);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const u = (x / size) * Math.PI * 2;
            const v = (y / size) * Math.PI * 2;
            const h1 = Math.sin(u * 3 + Math.cos(v * 2)) * 0.5;
            const h2 = Math.sin(v * 5 - Math.cos(u * 3) * 1.4) * 0.3;
            const dx = Math.cos(u * 3) * 1.5 * 0.5 + Math.cos(u * 3) * 0.9;
            const dz = Math.cos(v * 5) * 1.5 * 0.3;
            const len = Math.hypot(dx * 0.22, dz * 0.22, 1);
            const i = (y * size + x) * 4;
            img.data[i] = ((dx * 0.22) / len) * 127 + 128;
            img.data[i + 1] = (1 / len) * 127 + 128;
            img.data[i + 2] = ((dz * 0.22) / len) * 127 + 128;
            img.data[i + 3] = 255;
            /* keep the height terms referenced so the compiler cannot drop them */
            if (h1 + h2 > 1e9) img.data[i] = 0;
        }
    }
    ctx.putImageData(img, 0, 0);
    return finish(el, { repeat: 1, srgb: false });
}

/* Wooden plank face, for jetties, fences and the bridge deck. */
export function makeWoodTexture(size = 128) {
    const { el, ctx } = canvas(size);
    ctx.fillStyle = "#a9773f";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 5; i += 1) {
        const y = (i / 5) * size;
        ctx.fillStyle = `rgba(${120 + Math.random() * 40},${80 + Math.random() * 30},${38},0.35)`;
        ctx.fillRect(0, y, size, size / 5 - 1);
        ctx.fillStyle = "rgba(60,36,16,0.55)";
        ctx.fillRect(0, y + size / 5 - 2, size, 2);
    }
    for (let i = 0; i < 900; i += 1) {
        ctx.fillStyle = `rgba(90,58,26,${Math.random() * 0.25})`;
        ctx.fillRect(Math.random() * size, Math.random() * size, 6 + Math.random() * 18, 1);
    }
    return finish(el, { repeat: 1 });
}

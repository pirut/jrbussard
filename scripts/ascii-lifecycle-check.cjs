#!/usr/bin/env node
/*
 * The ASCII pass in a real browser: what the unit tests cannot reach.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright CHROME=/path/to/chrome \
 *     node scripts/ascii-lifecycle-check.cjs
 *
 * Bundles asciiPass.js and Diorama.js with esbuild, runs them in headless
 * Chrome on SwiftShader, and checks the renderer's lifecycle and callers:
 * the history targets ping-pong; resize, the min tier, a zoom and an
 * orbiting Diorama all drop history; and a lost and restored WebGL context
 * neither keeps history nor leaves cells blank (review of PR #27). Exits 1
 * on a failure, 0 when it passes, and 0 with a note when Playwright or
 * Chrome is not available, since neither is a dependency of this repo.
 */
const path = require("node:path");
const fs = require("node:fs");

const root = path.join(__dirname, "..");
let chromium;
try {
    ({ chromium } = require(process.env.PLAYWRIGHT || "playwright"));
} catch {
    console.log("ascii-lifecycle-check: Playwright not found (set PLAYWRIGHT=/path/to/playwright); skipped.");
    process.exit(0);
}
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(chrome)) {
    console.log(`ascii-lifecycle-check: no Chrome at ${chrome} (set CHROME); skipped.`);
    process.exit(0);
}
const esbuild = require(path.join(root, "node_modules/esbuild"));

(async () => {
    const bundle = await esbuild.build({
        stdin: {
            contents: `import * as THREE from 'three';
                import { AsciiPass } from './src/arcade/ascii3d/asciiPass.js';
                import { createIsoCamera, placeIsoCamera, snapIsoCamera } from './src/arcade/ascii3d/iso.js';
                import Diorama from './src/site3d/Diorama.js';
                window.R = { THREE, AsciiPass, createIsoCamera, placeIsoCamera, snapIsoCamera, Diorama };`,
            resolveDir: root,
        },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        loader: { ".js": "jsx" },
        logLevel: "silent",
    });
    const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.route("http://ascii.test/**", (route) =>
        route.fulfill({ contentType: "text/html", body: `<!DOCTYPE html><html><body><script>${bundle.outputFiles[0].text}</script></body></html>` }),
    );
    await page.goto("http://ascii.test/");
    const r = await page.evaluate(async () => {
        const { THREE, AsciiPass, createIsoCamera, placeIsoCamera, snapIsoCamera, Diorama } = window.R;
        const out = {};

        /* The 404 page's orbiting Diorama. */
        const raf = window.requestAnimationFrame;
        window.requestAnimationFrame = () => 0;
        const host = document.createElement("div");
        host.style.cssText = "width:320px;height:200px";
        document.body.append(host);
        const diorama = new Diorama(host, "lost");
        const before = diorama.camera.matrixWorld.clone();
        diorama.time = 10;
        diorama.frame();
        out.diorama = {
            moved: !before.equals(diorama.camera.matrixWorld),
            history: diorama.ascii.uniforms.uHistory.value,
            tracks: diorama.ascii.uniforms.uCamToWorld.value.equals(diorama.camera.matrixWorld),
        };
        diorama.dispose();
        host.remove();
        window.requestAnimationFrame = raf;

        const renderer = new THREE.WebGLRenderer({ antialias: false });
        renderer.setSize(640, 560);
        renderer.setClearColor(0x333333, 0.03125);
        const pass = new AsciiPass();
        const p = pass.pickMaterial.uniforms;
        pass.setSize({ cols: 80, rows: 40, cellW: 8, cellH: 14, offX: 0, offY: 0 });
        const cam = createIsoCamera();
        const scene = new THREE.Scene();
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        scene.add(mesh);
        const frame = (height = 11) => {
            placeIsoCamera(cam, new THREE.Vector3(), Math.PI / 4, height, 2);
            snapIsoCamera(cam, 80, 40, p.uCellShift.value);
            renderer.setRenderTarget(pass.target);
            renderer.render(scene, cam);
            pass.render(renderer, cam);
            return p.uHistory.value;
        };
        out.history = { first: frame(), still: frame(), zoom: frame(10.99), settled: frame(10.99) };
        out.pingpong = pass.pick !== pass.pickPrev && p.tPrev.value === pass.pickPrev.texture && pass.drawMaterial.uniforms.tPick.value === pass.pick.texture;
        pass.setTier("min");
        out.minHistory = frame(10.99);
        pass.setTier("full");
        frame(10.99);
        out.backToFull = frame(10.99);
        pass.setSize({ cols: 80, rows: 40, cellW: 8, cellH: 14, offX: 0, offY: 0 });
        out.resizeHistory = frame(10.99);
        const gl = renderer.getContext();
        out.glError = gl.getError();
        pass.dispose();

        /* A flat surface at ramp level ~1.1, through a lost and restored
           context. */
        const flat = new AsciiPass();
        flat.setSize({ cols: 80, rows: 40, cellW: 8, cellH: 14, offX: 0, offY: 0 });
        const f = flat.pickMaterial.uniforms;
        f.uDither.value = 0;
        const srgb = 0.035 + 0.11 / (1.25 * 0.95 * 1.7);
        const linear = Math.pow(srgb, 2.2);
        const texture = (v) => {
            const data = new Float32Array(320 * 240 * 4);
            for (let i = 0; i < data.length; i += 4) data.set(v, i);
            const t = new THREE.DataTexture(data, 320, 240, THREE.RGBAFormat, THREE.FloatType);
            t.needsUpdate = true;
            return t;
        };
        f.tColor.value = texture([linear, linear, linear, 0.03125]);
        f.tDepth.value = texture([0.5, 0.5, 0.5, 1]);
        const still = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
        still.updateMatrixWorld();
        const glyphs = () => {
            flat.render(renderer, still);
            const data = new Uint8Array(80 * 40 * 4);
            renderer.readRenderTargetPixels(flat.pick, 0, 0, 80, 40, data);
            return data.filter((v, i) => i % 4 === 3 && v > 0).length;
        };
        const lit = glyphs();
        glyphs();
        const restored = new Promise((res) => renderer.domElement.addEventListener("webglcontextrestored", res, { once: true }));
        renderer.forceContextLoss();
        await new Promise((res) => setTimeout(res, 70));
        renderer.forceContextRestore();
        await restored;
        const after = glyphs();
        out.restore = { lit, history: f.uHistory.value, after, later: glyphs() };
        flat.dispose();
        mesh.geometry.dispose();
        mesh.material.dispose();
        renderer.dispose();
        return out;
    });
    await browser.close();

    const checks = [
        ["no page or WebGL errors", errors.length === 0 && r.glError === 0],
        ["history targets ping-pong", r.pingpong],
        ["a still iso camera keeps history", r.history.first === 0 && r.history.still === 1 && r.history.settled === 1],
        ["a zoom drops history", r.history.zoom === 0],
        ["the min tier drops history, full brings it back", r.minHistory === 0 && r.backToFull === 1],
        ["a resize drops history", r.resizeHistory === 0],
        ["the orbiting Diorama hands over its camera and drops history", r.diorama.moved && r.diorama.tracks && r.diorama.history === 0],
        ["a restored context drops history", r.restore.history === 0],
        ["a restored context keeps every glyph", r.restore.lit > 0 && r.restore.after === r.restore.lit && r.restore.later === r.restore.lit],
    ];
    console.log(JSON.stringify(r));
    if (errors.length) console.log(errors.join("\n"));
    let failed = 0;
    for (const [name, ok] of checks) {
        console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
        if (!ok) failed += 1;
    }
    process.exit(failed ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});

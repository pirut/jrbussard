import * as THREE from "three";
import { buildSurvivor, buildCreature, buildStructure, pose } from "../../src/arcade/ascii3d/models";
import { mergeModel } from "../../src/arcade/ascii3d/mergeModel";
import { Batch, addTree, addRock } from "../../src/arcade/ascii3d/terrainMesh";

/*
 * Every model in a row, lit plainly, for comparing changes to the builders
 * without the ASCII pass in the way. `?view=figures|creatures|world` picks a
 * row and `?still` freezes the pose. Run with:
 *   npx vite scripts/model-gallery
 */

const params = new URLSearchParams(location.search);
const view = params.get("view") || "figures";
const t = Number(params.get("t") || 0.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#2a3036");
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3226, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -6;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshLambertMaterial({ color: "#3d5f36" }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const LOOKS = [
    { skin: "bronze", hair: "ink", outfit: "tide", cloak: "sea", hairstyle: "long", headwear: "none" },
    { skin: "porcelain", hair: "copper", outfit: "rust", cloak: "wine", hairstyle: "braids", headwear: "hood" },
    { skin: "umber", hair: "ash", outfit: "ivory", cloak: "ochre", hairstyle: "cropped", headwear: "brim" },
    { skin: "sand", hair: "gold", outfit: "plum", cloak: "dusk", hairstyle: "shaved", headwear: "crown" },
    { skin: "ebony", hair: "moss", outfit: "fern", cloak: "pine", hairstyle: "cropped", headwear: "none" },
];

const row = [];
if (view === "figures") {
    LOOKS.forEach((appearance, i) => {
        row.push({ model: buildSurvivor({ appearance, tools: { armor: i % 3, weapon: i % 3 } }), animate: true, i });
    });
} else if (view === "creatures") {
    ["rat", "wolf", "kobold", "troll", "shade"].forEach((kind, i) => row.push({ model: buildCreature(kind), animate: true, i }));
} else {
    ["wall", "door", "torch", "campfire", "workbench", "furnace", "chest", "bedroll"].forEach((kind) =>
        row.push({ model: buildStructure({ kind, open: false }, { lit: true }) }),
    );
    const batch = new Batch();
    [[3, 1], [9, 4], [5, 2], [2, 7]].forEach(([x, y], i) => addTree(batch, i * 2.4 - 3.6, -1.2, 0, x * 31 + y));
    ["stone", "coal", "ore", "crystal"].forEach((res, i) => addRock(batch, i * 2.4 - 3.6, 1, 0, res));
    const trees = new THREE.Group();
    batch.meshes().forEach((m) => trees.add(m));
    trees.position.set(0, 0, -2.5);
    scene.add(trees);
}

const spacing = view === "world" ? 1.6 : 1.5;
row.forEach((entry, i) => {
    mergeModel(entry.model);
    entry.model.position.x = (i - (row.length - 1) / 2) * spacing;
    entry.model.traverse((n) => {
        if (n.isMesh) n.castShadow = true;
    });
    scene.add(entry.model);
});

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 100);
const far = view === "world" ? 15 : 8.5;
camera.position.set(0, far * 0.45, far);
camera.lookAt(0, view === "world" ? 0.8 : 0.85, 0);

function count() {
    let tris = 0;
    let meshes = 0;
    row.forEach(({ model }) =>
        model.traverse((n) => {
            if (!n.isMesh) return;
            meshes += 1;
            const g = n.geometry;
            tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
        }),
    );
    return { tris, meshes, per: row.map(({ model }) => model.userData.kind) };
}

const c = count();
const statsEl = document.getElementById("stats");
const clock = new THREE.Clock();
function frame() {
    const now = clock.getElapsedTime();
    const still = params.has("still");
    row.forEach(({ model, animate, i }) => {
        if (animate) pose(model, { stride: still ? t * 4 : now * 4 + i, moving: still ? 1 : 0.9, t: still ? t + i : now + i });
    });
    renderer.render(scene, camera);
    statsEl.textContent = `${view}: ${row.length} models, ${c.meshes} meshes after merge, ${Math.round(c.tris)} triangles\nframe draw calls ${renderer.info.render.calls}, frame triangles ${renderer.info.render.triangles}`;
    window.__stats = { ...c, calls: renderer.info.render.calls };
    if (!still) requestAnimationFrame(frame);
}
frame();

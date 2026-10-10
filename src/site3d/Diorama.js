import * as THREE from "three";
import { AsciiPass, glyphCode } from "../arcade/ascii3d/asciiPass";
import { disposeMaterials, material } from "../arcade/ascii3d/materials";
import { buildSurvivor, pose } from "../arcade/ascii3d/models";
import { PHASES } from "../arcade/ascii3d/AsciiWorld";
import { Batch, tint, hash, addTree, addBlades, wind } from "../arcade/ascii3d/terrainMesh";
import { KIND } from "../world/tiles";
import { church, kremlinTower, setbackTower, stalinTower, wallTile } from "../arcade/ascii3d/architecture";
import { buildProp, buildTorch, disposeProps } from "./props";
import { oddity } from "./warren";

/*
 * A small scene in the same type as the workshop, for the pages that are not
 * the workshop: behind an arcade cabinet, or on the page for a wrong turn.
 * One camera drifting around one set piece, through the Commons' ASCII pass.
 */

function flagstones(batch, w, d) {
    for (let z = -d; z <= d; z += 1) {
        for (let x = -w; x <= w; x += 1) {
            const flag = (Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? 0.85 : 1;
            const c = new THREE.Color("#4f4552").multiplyScalar(flag * (0.88 + hash(x, z, 3) * 0.14));
            batch.quad("path", [x - 0.5, 0, z - 0.5], [x - 0.5, 0, z + 0.5], [x + 0.5, 0, z + 0.5], [x + 0.5, 0, z - 0.5], c);
        }
    }
}

/* The arcade floor: a row of lit cabinets under two torches. */
function arcade(scene) {
    const batch = new Batch();
    flagstones(batch, 9, 5);
    /* The back of the hall is a Kremlin wall with towers, and the city
       climbing behind it. */
    for (let x = -8; x <= 8; x += 1) wallTile(batch, x, -5, 0, 3.4, true);
    kremlinTower(batch, -9, -5, 0, { w: 2.4, h: 6.4, crown: "star" });
    kremlinTower(batch, 9, -5, 0, { w: 2.4, h: 6.4, crown: "cross" });
    kremlinTower(batch, 0, -5, 0, { w: 2.2, h: 5.2, crown: "star" });
    church(batch, -5, -9, 0, { scale: 1, belfry: 0 });
    stalinTower(batch, 5, -10, 0, { scale: 0.8, crown: "cross" });
    oddity(batch, 12, -12, 0, 0.3, 22);
    setbackTower(batch, -12, -12, 0, 10, { crown: "cross" });
    const ground = batch.meshes();
    ground.forEach((m) => scene.add(m));
    const props = [];
    for (let i = 0; i < 6; i += 1) {
        const prop = buildProp({ kind: KIND.ARCADE, index: i, x: 0, y: 0 });
        prop.group.position.set(-6.25 + i * 2.5, 0, -2.6);
        scene.add(prop.group);
        props.push(prop);
    }
    [-8, 8].forEach((x) => {
        const torch = buildTorch();
        torch.position.set(x, 0, -3.6);
        scene.add(torch);
        props.push({ group: torch, update() {} });
    });
    const lights = [
        [-3.5, 1.4, -1.6, 0xff7ad9],
        [3.5, 1.4, -1.6, 0x7fd7ff],
        [-8, 1.6, -3.4, 0xffb46b],
        [8, 1.6, -3.4, 0xffb46b],
    ].map(([x, y, z, c]) => {
        const light = new THREE.PointLight(c, 3.5, 9, 1.2);
        light.position.set(x, y, z);
        scene.add(light);
        return light;
    });
    return {
        center: new THREE.Vector3(0, 2.2, -2),
        distance: 11,
        pitch: 0.22,
        sway: 0.45,
        phase: "night",
        update(t) {
            props.forEach((p, i) => p.update(t, true, i * 1.3));
            lights[0].intensity = 3 + Math.sin(t * 2.1) * 0.6;
            lights[1].intensity = 3 + Math.sin(t * 1.7 + 1) * 0.6;
        },
        dispose() {
            props.forEach((p) => disposeProps(p.group));
            ground.forEach((m) => m.geometry.dispose());
        },
    };
}

/* Off the map: a clearing, a blank signpost, and someone standing lost. */
function lost(scene) {
    const batch = new Batch();
    for (let z = -12; z <= 12; z += 1) {
        for (let x = -12; x <= 12; x += 1) {
            const d = Math.hypot(x, z);
            if (d > 12.5) continue;
            const c = tint(d < 2.2 ? "#5a5240" : "#3d5f36", 0.88 + hash(x, z, 5) * 0.14).clone();
            batch.quad(d < 2.2 ? "path" : "grass", [x - 0.5, 0, z - 0.5], [x - 0.5, 0, z + 0.5], [x + 0.5, 0, z + 0.5], [x + 0.5, 0, z - 0.5], c);
            if (d >= 2.2) addBlades(batch, x, z, 0, 4, 1);
            if (d > 5.5 && (z < 1 || d > 14) && hash(x, z, 9) < 0.32) addTree(batch, x, z, 0);
        }
    }
    /* A skyline all the way round, beyond the trees. */
    for (let i = 0; i < 14; i += 1) {
        const a = (i / 14) * Math.PI * 2 + hash(i, 0, 3);
        const r = 17 + hash(i, 1, 3) * 4;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const pick = hash(i, 2, 3);
        if (pick < 0.3) oddity(batch, x, z, 0, hash(i, 4, 3), 14 + pick * 30);
        else if (pick < 0.6) setbackTower(batch, x, z, 0, 8 + pick * 6, { crown: i % 2 ? "star" : "cross" });
        else if (pick < 0.8) stalinTower(batch, x, z, 0, { scale: 0.7, tiers: 4, crown: i % 2 ? "star" : "cross" });
        else church(batch, x, z, 0, { scale: 0.9, belfry: i % 2 ? 1 : 0 });
    }
    const ground = batch.meshes();
    ground.forEach((m) => scene.add(m));
    const sign = buildProp({ kind: KIND.SIGN, index: 0, x: 0, y: 0 });
    sign.group.position.set(2.3, 0, -1.4);
    sign.group.rotation.y = -0.4;
    scene.add(sign.group);
    const mark = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 4, 10, Math.PI * 1.4), material("#d8b67c", "fire", { unlit: true }));
    mark.position.set(2.3, 2.15, -1.4);
    mark.rotation.z = -0.6;
    scene.add(mark);
    const wanderer = buildSurvivor({
        appearance: { skin: "sand", hair: "chestnut", outfit: "tide", cloak: "sea", hairstyle: "cropped", headwear: "none" },
    });
    wanderer.position.set(-0.6, 0, 0.3);
    wanderer.scale.setScalar(1.15);
    scene.add(wanderer);
    return {
        center: new THREE.Vector3(0.3, 3.2, 0),
        distance: 14,
        pitch: 0.14,
        orbit: 0.07,
        phase: "dusk",
        update(t) {
            /* Looking one way, then the other. */
            wanderer.rotation.y = 0.5 + Math.sin(t * 0.5) * 0.9;
            pose(wanderer, { stride: 0, moving: 0, t });
            mark.position.y = 2.15 + Math.sin(t * 1.6) * 0.08;
            mark.rotation.y = t * 0.8;
        },
        dispose() {
            disposeProps(sign.group);
            mark.geometry.dispose();
            ground.forEach((m) => m.geometry.dispose());
        },
    };
}

const SETS = { arcade, lost };

export default class Diorama {
    constructor(container, name, { cellWidth = 6, cellHeight = 10, reducedMotion = false } = {}) {
        this.container = container;
        this.reducedMotion = reducedMotion;
        this.cellCss = { w: cellWidth, h: cellHeight };
        this.time = 0;
        this.clock = new THREE.Clock();

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "low-power" });
        this.renderer.setPixelRatio(1);
        this.renderer.shadowMap.enabled = true;
        const canvas = this.renderer.domElement;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        container.appendChild(canvas);

        this.scene = new THREE.Scene();
        this.set = (SETS[name] || SETS.lost)(this.scene);
        const p = PHASES[this.set.phase];
        const bg = new THREE.Color(p.bg);
        this.scene.fog = new THREE.Fog(bg, this.set.distance * 1.1, this.set.distance * 3.4);
        this.scene.add(new THREE.HemisphereLight(p.sky, p.ground, p.hemi + 0.25));
        const sun = new THREE.DirectionalLight(p.sunColor, p.sun);
        sun.position.set(-8, 12, 6);
        sun.castShadow = true;
        this.scene.add(sun);
        this.renderer.setClearColor(bg, glyphCode(0));

        this.camera = new THREE.PerspectiveCamera(46, 2, 0.5, 120);
        this.ascii = new AsciiPass();
        this.ascii.uniforms.uBackground.value.copy(bg).convertLinearToSRGB();
        this.ascii.uniforms.uNear.value = this.camera.near;
        this.ascii.uniforms.uFar.value = this.camera.far;
        this.ascii.uniforms.uStars.value = { night: 1, dusk: 0.5, dawn: 0.3, day: 0 }[this.set.phase];
        this.ascii.uniforms.uClouds.value = 0.2;

        this.resize = this.resize.bind(this);
        this.frame = this.frame.bind(this);
        this.observer = new ResizeObserver(this.resize);
        this.observer.observe(container);
        this.resize();
        this.frame();
    }

    resize() {
        const box = this.container.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.floor(box.width * dpr));
        const height = Math.max(1, Math.floor(box.height * dpr));
        const cellW = Math.max(3, Math.round(this.cellCss.w * dpr));
        const cellH = Math.max(5, Math.round(this.cellCss.h * dpr));
        const cols = Math.max(8, Math.floor(width / cellW));
        const rows = Math.max(6, Math.floor(height / cellH));
        this.grid = { dpr, width, height, cellW, cellH, cols, rows, offX: Math.floor((width - cols * cellW) / 2), offY: Math.floor((height - rows * cellH) / 2) };
        this.renderer.setSize(width, height, false);
        this.ascii.setSize(this.grid);
        this.camera.aspect = (cols * cellW) / (rows * cellH);
        this.camera.updateProjectionMatrix();
    }

    frame() {
        this.raf = requestAnimationFrame(this.frame);
        const dt = Math.min(0.1, this.clock.getDelta());
        if (!this.reducedMotion) this.time += dt;
        const t = this.time;
        const s = this.set;
        const yaw = s.orbit ? t * s.orbit + 0.6 : Math.sin(t * 0.12) * (s.sway || 0);
        const back = s.distance * Math.cos(s.pitch);
        this.camera.position.set(s.center.x - Math.sin(yaw) * back, s.center.y + s.distance * Math.sin(s.pitch), s.center.z + Math.cos(yaw) * back);
        this.camera.lookAt(s.center);
        s.update(t);
        wind.uTime.value = t;
        this.ascii.uniforms.uTime.value = t;
        this.renderer.setRenderTarget(this.ascii.target);
        this.renderer.render(this.scene, this.camera);
        this.ascii.render(this.renderer);
    }

    dispose() {
        cancelAnimationFrame(this.raf);
        this.observer.disconnect();
        this.set.dispose();
        this.ascii.dispose();
        disposeMaterials();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

import * as THREE from "three";
import { CHUNK, WATER, tileAt } from "../../lib/terrain";
import { buildAtlas, createAsciiMaterial, glyphCode } from "./asciiPass";
import { buildChunk, createWater, rippleWater, groundHeight, standHeight, WATER_LEVEL, wind } from "./terrainMesh";
import {
    buildSurvivor,
    buildCreature,
    buildStructure,
    buildCursor,
    structureKey,
    lookKey,
    pose,
    flashModel,
    disposeModel,
} from "./models";
import { disposeMaterials } from "./materials";

/*
 * The Commons, as a 3D scene drawn in characters.
 *
 * This owns everything that happens per frame: the renderer, the camera, the
 * models, and the ASCII pass. React hands it the latest server snapshot with
 * setState() and it eases every person and creature from where they were to
 * where the server now says they are, so tile-by-tile movement on the server
 * reads as walking on screen.
 *
 * It decides nothing about the game. Picking a tile under the pointer is the
 * only thing it reports back, and the server still judges whatever is done
 * there.
 */

/*
 * Camera distance and pitch at each zoom step. Close in, the camera drops
 * low behind you like a third-person game and the horizon comes into view;
 * pulled out, it rises toward a map.
 */
export const ZOOMS = [5, 7.5, 11, 16];
const PITCHES = [0.32, 0.46, 0.68, 0.92];
const FOV = 38;
const SAMPLES = 2;
const MAX_LIGHTS = 6;

/* Sky, sun and fill for each part of the day. Colours are sRGB hex. */
const PHASES = {
    dawn: { sun: 1.3, sunColor: "#ffc796", hemi: 0.6, sky: "#a9b0d8", ground: "#3a3a36", bg: "#0d1020", angle: 0.5 },
    day: { sun: 1.7, sunColor: "#f6efe0", hemi: 0.8, sky: "#b9cdf0", ground: "#34443a", bg: "#0c1322", angle: 1.0 },
    dusk: { sun: 1.0, sunColor: "#ff9d6a", hemi: 0.5, sky: "#a68cb0", ground: "#3a3030", bg: "#110d1c", angle: 0.4 },
    night: { sun: 0.4, sunColor: "#8fa7ff", hemi: 0.26, sky: "#4f5c95", ground: "#1a1e2a", bg: "#070a16", angle: 0.8 },
};
const WEATHER_DIM = { clear: 1, rain: 0.72, storm: 0.55, fog: 0.82 };

const tmp = new THREE.Vector3();
const ndc = new THREE.Vector2();

function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}


export default class AsciiWorld {
    constructor(container, { cellWidth = 8, cellHeight = 14, reducedMotion = false } = {}) {
        this.container = container;
        this.reducedMotion = reducedMotion;
        this.cellCss = { w: cellWidth, h: cellHeight };
        this.state = null;
        this.aim = null;
        this.aimOk = true;
        this.turn = 0;
        this.yaw = 0;
        this.zoom = 1;
        this.distance = ZOOMS[1];
        this.orbit = false;
        this.labels = new Map();
        this.players = new Map();
        this.creatures = [];
        this.leaving = [];
        this.structures = new Map();
        this.chunks = new Map();
        this.flames = [];
        this.focus = new THREE.Vector3();
        this.focusReady = false;
        this.selfFacing = null;
        this.clock = new THREE.Clock();
        this.time = 0;
        this.flash = 0;
        this.nextFlash = 4;

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
        this.renderer.setPixelRatio(1);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.autoClear = true;
        const canvas = this.renderer.domElement;
        canvas.className = "ascii3d__canvas";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        container.appendChild(canvas);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x0b120d, 20, 40);
        this.camera = new THREE.PerspectiveCamera(FOV, 2, 0.5, 120);

        this.hemi = new THREE.HemisphereLight(0xd3e6ff, 0x4a5a3a, 1);
        this.scene.add(this.hemi);
        this.sun = new THREE.DirectionalLight(0xffffff, 2);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        this.sun.shadow.bias = -0.0015;
        const sc = this.sun.shadow.camera;
        sc.left = -22;
        sc.right = 22;
        sc.top = 22;
        sc.bottom = -22;
        sc.near = 1;
        sc.far = 80;
        this.scene.add(this.sun, this.sun.target);
        this.lightPool = [];
        for (let i = 0; i < MAX_LIGHTS; i += 1) {
            const light = new THREE.PointLight(0xffb46b, 0, 8, 1.2);
            this.scene.add(light);
            this.lightPool.push(light);
        }
        this.phase = { ...PHASES.day, sunColor: new THREE.Color(PHASES.day.sunColor), sky: new THREE.Color(PHASES.day.sky), ground: new THREE.Color(PHASES.day.ground), bg: new THREE.Color(PHASES.day.bg) };

        this.water = createWater(72);
        this.water.position.y = WATER_LEVEL;
        this.scene.add(this.water);

        this.cursor = buildCursor();
        this.cursor.visible = false;
        this.scene.add(this.cursor);

        this.splashes = this.createSplashes();
        this.scene.add(this.splashes);
        this.embers = this.createEmbers();
        this.scene.add(this.embers);

        /* The ASCII pass: a full-screen triangle reading the offscreen render. */
        this.postScene = new THREE.Scene();
        this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        this.postScene.add(this.quad);
        this.target = null;
        this.atlas = null;

        this.resize = this.resize.bind(this);
        this.frame = this.frame.bind(this);
        this.observer = new ResizeObserver(this.resize);
        this.observer.observe(container);
        this.resize();
        this.raf = requestAnimationFrame(this.frame);
    }

    /* ── Size and the character grid ───────────────────────────────────── */

    resize() {
        const box = this.container.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.floor(box.width * dpr));
        const height = Math.max(1, Math.floor(box.height * dpr));
        const cellW = Math.max(3, Math.round(this.cellCss.w * dpr));
        const cellH = Math.max(5, Math.round(this.cellCss.h * dpr));
        const cols = Math.max(8, Math.floor(width / cellW));
        const rows = Math.max(6, Math.floor(height / cellH));
        this.grid = {
            dpr,
            width,
            height,
            cellW,
            cellH,
            cols,
            rows,
            offX: Math.floor((width - cols * cellW) / 2),
            offY: Math.floor((height - rows * cellH) / 2),
        };
        this.renderer.setSize(width, height, false);

        if (!this.atlas || this.atlas.cellW !== cellW || this.atlas.cellH !== cellH) {
            if (this.atlas) this.atlas.texture.dispose();
            this.atlas = { ...buildAtlas(cellW, cellH), cellW, cellH };
            if (this.quad.material) this.quad.material.dispose();
            this.quad.material = createAsciiMaterial(this.atlas);
        }

        if (this.target) {
            this.target.depthTexture.dispose();
            this.target.dispose();
        }
        this.target = new THREE.WebGLRenderTarget(cols * SAMPLES, rows * SAMPLES, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
        });
        this.target.depthTexture = new THREE.DepthTexture(cols * SAMPLES, rows * SAMPLES);

        const u = this.quad.material.uniforms;
        u.tColor.value = this.target.texture;
        u.tDepth.value = this.target.depthTexture;
        u.uCells.value.set(cols, rows);
        u.uCellPx.value.set(cellW, cellH);
        u.uOffset.value.set(this.grid.offX, this.grid.offY);
        this.camera.aspect = (cols * cellW) / (rows * cellH);
        this.camera.updateProjectionMatrix();
    }

    setCellSize(w, h) {
        this.cellCss = { w, h };
        this.atlas = null;
        this.resize();
    }

    get columns() {
        return this.grid.cols;
    }

    /* ── Inputs from React ─────────────────────────────────────────────── */

    setState(state) {
        this.state = state;
        if (!state) return;
        this.syncStructures(state);
        this.syncPlayers(state);
        this.syncCreatures(state);
        this.setPhase(state.phase, state.weather);
    }

    setAim(aim, ok = true) {
        this.aim = aim;
        this.aimOk = ok;
    }

    setTurn(turn) {
        this.turn = ((turn % 4) + 4) % 4;
    }

    setZoom(zoom) {
        this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, zoom));
    }

    setRaw(raw) {
        this.quad.material.uniforms.uRaw.value = raw ? 1 : 0;
    }

    setOrbit(orbit) {
        this.orbit = orbit;
    }

    /* Turn yourself to face what you are working on. */
    faceSelf(dx, dy) {
        this.selfFacing = Math.atan2(dx, dy);
    }

    /* Swing the arm: chopping, mining, hitting. Purely for show. */
    swingSelf() {
        const self = [...this.players.values()].find((p) => p.data.self);
        if (self) self.attackStart = this.time;
    }

    registerLabel(id, element) {
        if (element) this.labels.set(id, element);
        else this.labels.delete(id);
    }

    /* The world tile under a point on screen, or null. */
    pick(clientX, clientY) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const g = this.grid;
        const px = (clientX - rect.left) * g.dpr - g.offX;
        const py = g.height - (clientY - rect.top) * g.dpr - g.offY;
        const w = g.cols * g.cellW;
        const h = g.rows * g.cellH;
        if (px < 0 || py < 0 || px > w || py > h) return null;
        ndc.set((px / w) * 2 - 1, (py / h) * 2 - 1);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(ndc, this.camera);
        let height = this.focus.y;
        let tile = null;
        /* The ground is terraced, so settle on the height of the tile hit. */
        for (let i = 0; i < 3; i += 1) {
            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
            const hit = ray.ray.intersectPlane(plane, tmp);
            if (!hit) return tile;
            tile = { x: Math.round(hit.x), y: Math.round(hit.z) };
            const next = Math.max(WATER_LEVEL, groundHeight(tile.x, tile.y));
            if (Math.abs(next - height) < 0.01) break;
            height = next;
        }
        return tile;
    }

    /* ── Server snapshot → models ──────────────────────────────────────── */

    bridged(x, y) {
        const s = this.structures.get(`${x},${y}`);
        return Boolean(s && s.kind === "floor");
    }

    entityHeight(x, y) {
        return standHeight(x, y, this.bridged(x, y));
    }

    syncStructures(state) {
        const seen = new Set();
        state.cells.forEach((cell) => {
            const key = `${cell.x},${cell.y}`;
            seen.add(key);
            const overWater = tileAt(cell.x, cell.y) === WATER;
            const ctx = {
                lit: cell.kind === "campfire" ? cell.fuelUntil > state.now : true,
                overWater,
                deck: WATER_LEVEL + 0.12,
            };
            const k = structureKey(cell, ctx);
            const existing = this.structures.get(key);
            if (existing && existing.key === k) {
                if (existing.group.userData.hinge) existing.group.userData.open = cell.open ? 1 : 0;
                return;
            }
            if (existing) this.removeStructure(key);
            const group = buildStructure(cell, ctx);
            if (!group) return;
            group.position.set(cell.x, overWater ? 0 : groundHeight(cell.x, cell.y), cell.y);
            /* Doors and signs face whichever way has open ground. */
            if (cell.kind === "door") {
                const walls = state.cells.filter((c) => c.kind === "wall");
                const ew = walls.some((c) => c.y === cell.y && Math.abs(c.x - cell.x) === 1);
                if (!ew) group.rotation.y = Math.PI / 2;
            }
            group.traverse((node) => {
                if (node.userData.flame) this.flames.push(node);
            });
            this.scene.add(group);
            this.structures.set(key, { group, key: k, kind: cell.kind });
        });
        [...this.structures.keys()].forEach((key) => {
            if (!seen.has(key)) this.removeStructure(key);
        });
    }

    removeStructure(key) {
        const s = this.structures.get(key);
        if (!s) return;
        s.group.traverse((node) => {
            if (node.userData.flame) this.flames = this.flames.filter((f) => f !== node);
        });
        disposeModel(s.group);
        this.scene.remove(s.group);
        this.structures.delete(key);
    }

    moveEntity(entity, x, y, duration) {
        if (entity.to.x === x && entity.to.y === y) return;
        const far = Math.hypot(entity.to.x - x, entity.to.y - y) > 2.5;
        const dx = x - entity.to.x;
        const dy = y - entity.to.y;
        entity.from = far ? { x, y } : { x: entity.pos.x, y: entity.pos.z };
        entity.to = { x, y };
        entity.start = this.time;
        /* Steps that come in a steady rhythm glide into one another instead of
           stopping at every tile: each one takes as long as the gap since the
           last. */
        const gap = this.time - entity.lastStep;
        entity.duration = gap < duration * 3 ? Math.min(Math.max(gap, duration * 0.8), duration * 2.2) : duration;
        if (!far) {
            entity.facing = Math.atan2(dx, dy);
            entity.lastStep = this.time;
        }
    }

    makeEntity(model, x, y) {
        this.scene.add(model);
        const h = this.entityHeight(x, y);
        model.position.set(x, h, y);
        return {
            model,
            from: { x, y },
            to: { x, y },
            pos: model.position,
            start: 0,
            duration: 0.15,
            facing: 0,
            yaw: 0,
            stride: 0,
            moving: 0,
            lastStep: -10,
            attackStart: -10,
            hurt: 0,
            flashUntil: 0,
            down: 0,
            born: this.time,
            seed: Math.random() * 7,
            baseScale: model.scale.x,
        };
    }

    syncPlayers(state) {
        const seen = new Set();
        state.players.forEach((p) => {
            seen.add(p.id);
            const key = lookKey(p);
            let entity = this.players.get(p.id);
            if (entity && entity.key !== key) {
                this.scene.remove(entity.model);
                const model = buildSurvivor(p);
                model.position.copy(entity.pos);
                this.scene.add(model);
                entity.model = model;
                entity.pos = model.position;
                entity.key = key;
            }
            if (!entity) {
                entity = this.makeEntity(buildSurvivor(p), p.x, p.y);
                entity.key = key;
                entity.facing = p.self ? Math.PI : 0;
                this.players.set(p.id, entity);
            }
            if (entity.data && p.hp < entity.data.hp) {
                this.hit(entity);
                /* Whatever bit them is probably standing next to them. */
                this.strikeFrom(this.creatures, entity);
            }
            entity.data = p;
            this.moveEntity(entity, p.x, p.y, 0.15);
        });
        [...this.players.keys()].forEach((id) => {
            if (seen.has(id)) return;
            this.leave(this.players.get(id));
            this.players.delete(id);
        });
    }

    /*
     * Creatures have no ids in the snapshot, so each is matched to the nearest
     * one of its kind from last time. They step one tile per server tick, so
     * the nearest is almost always the same animal.
     */
    syncCreatures(state) {
        const pool = [...this.creatures];
        const next = [];
        state.monsters.forEach((m) => {
            let best = -1;
            let bestDistance = 2.5;
            pool.forEach((c, i) => {
                if (!c || c.kind !== m.kind) return;
                const d = Math.hypot(c.to.x - m.x, c.to.y - m.y);
                if (d <= bestDistance) {
                    best = i;
                    bestDistance = d;
                }
            });
            let entity;
            if (best >= 0) {
                entity = pool[best];
                pool[best] = null;
                if (m.hp < entity.data.hp) {
                    this.hit(entity);
                    this.strikeFrom([...this.players.values()].filter((p) => !p.data?.self), entity);
                }
            } else {
                entity = this.makeEntity(buildCreature(m.kind), m.x, m.y);
                entity.kind = m.kind;
                entity.facing = Math.random() * Math.PI * 2;
            }
            entity.data = m;
            this.moveEntity(entity, m.x, m.y, 0.4);
            next.push(entity);
        });
        pool.forEach((c) => {
            if (c) this.leave(c);
        });
        this.creatures = next;
    }

    hit(entity) {
        entity.hurt = 1;
        entity.flashUntil = this.time + 0.09;
    }

    /* The nearest of `from` within reach turns to `target` and swings. */
    strikeFrom(from, target) {
        let best = null;
        let bestDistance = 1.6;
        from.forEach((e) => {
            const d = Math.hypot(e.to.x - target.to.x, e.to.y - target.to.y);
            if (d > 0 && d <= bestDistance && this.time - e.attackStart > 0.5) {
                best = e;
                bestDistance = d;
            }
        });
        if (!best) return;
        best.facing = Math.atan2(target.to.x - best.to.x, target.to.y - best.to.y);
        best.attackStart = this.time - 0.12;
    }

    /* Someone left or something died: shrink into the ground, then go. */
    leave(entity) {
        entity.leftAt = this.time;
        flashModel(entity.model, false);
        this.leaving.push(entity);
    }

    updateLeaving() {
        this.leaving = this.leaving.filter((e) => {
            const k = (this.time - e.leftAt) / 0.45;
            if (k >= 1) {
                this.scene.remove(e.model);
                return false;
            }
            const scale = e.baseScale * (1 - k * k);
            e.model.scale.setScalar(Math.max(0.001, scale));
            e.model.rotation.y += 0.25;
            return true;
        });
    }

    setPhase(phase, weather) {
        this.phaseName = PHASES[phase] ? phase : "day";
        this.weather = WEATHER_DIM[weather] ? weather : "clear";
    }

    /* ── Per frame ─────────────────────────────────────────────────────── */

    /* Little rings where drops land; they come out as o and * on the ground. */
    createSplashes() {
        const count = 60;
        const mesh = new THREE.InstancedMesh(
            new THREE.TorusGeometry(0.06, 0.02, 3, 8).rotateX(Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x6f86ad, blending: THREE.NoBlending, transparent: false, opacity: glyphCode(2) }),
            count,
        );
        mesh.userData.life = new Float32Array(count);
        mesh.frustumCulled = false;
        mesh.visible = false;
        return mesh;
    }

    updateSplashes(dt, on) {
        const mesh = this.splashes;
        mesh.visible = on;
        if (!on) return;
        const life = mesh.userData.life;
        const m = new THREE.Matrix4();
        for (let i = 0; i < life.length; i += 1) {
            life[i] -= dt * 2.5;
            if (life[i] <= 0) {
                life[i] = 0.4 + Math.random() * 0.6;
                const x = Math.round(this.focus.x + (Math.random() - 0.5) * 22);
                const z = Math.round(this.focus.z + (Math.random() - 0.5) * 22);
                mesh.userData[i] = [x + Math.random() - 0.5, Math.max(WATER_LEVEL, groundHeight(x, z)) + 0.04, z + Math.random() - 0.5];
            }
            const [x, y, z] = mesh.userData[i];
            const grow = 1.2 - life[i] * 0.6;
            m.makeScale(grow, 1, grow).setPosition(x, y, z);
            mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }

    /* Sparks rising off every lit fire. */
    createEmbers() {
        const count = 48;
        const mesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.07, 0.07, 0.07),
            new THREE.MeshBasicMaterial({ color: 0xffb35c, blending: THREE.NoBlending, transparent: false, opacity: glyphCode(4) }),
            count,
        );
        mesh.userData.seeds = Array.from({ length: count }, () => [Math.random(), Math.random(), Math.random()]);
        mesh.frustumCulled = false;
        return mesh;
    }

    updateEmbers() {
        const fires = [];
        this.structures.forEach((s) => {
            if (s.group.userData.light && s.kind !== "furnace") fires.push(s.group.position.clone().setY(s.group.position.y + s.group.userData.light.y - 0.3));
        });
        const mesh = this.embers;
        mesh.visible = fires.length > 0 && !this.reducedMotion;
        if (!mesh.visible) return;
        fires.sort((a, b) => a.distanceTo(this.focus) - b.distanceTo(this.focus));
        const m = new THREE.Matrix4();
        mesh.userData.seeds.forEach(([a, b, c], i) => {
            const fire = fires[i % Math.min(fires.length, 6)];
            const t = (this.time * (0.5 + b * 0.5) + a) % 1;
            const x = fire.x + Math.sin(a * 40 + this.time * 2) * 0.25 * t + (c - 0.5) * 0.3;
            const z = fire.z + Math.cos(b * 40 + this.time * 1.7) * 0.25 * t;
            const size = 1 - t;
            m.makeScale(size, size, size).setPosition(x, fire.y + t * 1.6, z);
            mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
    }

    /* The drops themselves are characters drawn by the ASCII pass; here
       only how hard it is raining, and the splashes on the ground. */
    updateRain(dt) {
        const on = (this.weather === "rain" || this.weather === "storm") && !this.reducedMotion;
        this.updateSplashes(dt, on);
        const u = this.quad.material.uniforms;
        u.uTime.value = this.time;
        u.uRain.value = on ? (this.weather === "storm" ? 1 : 0.6) : 0;
    }

    /* Stars and cloud for the ASCII pass to draw where nothing else is. */
    updateSky(dt) {
        const u = this.quad.material.uniforms;
        const stars = { night: 1, dusk: 0.45, dawn: 0.3, day: 0 }[this.phaseName || "day"];
        const clouds = { clear: 0.15, fog: 0.5, rain: 0.75, storm: 1 }[this.weather || "clear"];
        const k = Math.min(1, dt * 0.8);
        u.uStars.value += (stars * (1 - clouds * 0.6) - u.uStars.value) * k;
        u.uClouds.value += (clouds - u.uClouds.value) * k;
        const day = this.phaseName === "day" || this.phaseName === "dawn";
        const tint = new THREE.Color(day ? 0x3c4a66 : 0x283350);
        if (this.flash > 0.2) tint.setHex(0x8f9fd0);
        u.uCloudColor.value.lerp(tint, this.flash > 0.2 ? 1 : k);
        /* Turning the camera slides the sky by the matching number of cells. */
        const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect);
        u.uSkyShift.value = (-this.yaw / hfov) * this.grid.cols;
    }

    updateEntity(entity, dt) {
        const t = entity.duration > 0 ? Math.min(1, (this.time - entity.start) / entity.duration) : 1;
        const x = entity.from.x + (entity.to.x - entity.from.x) * t;
        const z = entity.from.y + (entity.to.y - entity.from.y) * t;
        const moved = Math.hypot(x - entity.pos.x, z - entity.pos.z);
        const fromH = this.entityHeight(entity.from.x, entity.from.y);
        const toH = this.entityHeight(entity.to.x, entity.to.y);
        const h = fromH + (toH - fromH) * t + Math.sin(t * Math.PI) * (Math.abs(toH - fromH) > 0.05 ? 0.12 : 0);
        entity.pos.set(x, h, z);
        const walking = this.time - entity.lastStep < (entity.duration > 0.3 ? 0.55 : 0.28);
        entity.moving += ((walking ? 1 : 0) - entity.moving) * Math.min(1, dt * 12);
        entity.stride += moved * 4.6;
        entity.yaw = lerpAngle(entity.yaw, entity.facing, Math.min(1, dt * 14));
        entity.model.rotation.y = entity.yaw;
        entity.hurt = Math.max(0, entity.hurt - dt * 2.8);
        const dead = entity.data && entity.data.hp <= 0;
        entity.down = Math.min(1, Math.max(0, entity.down + (dead ? dt : -dt) * 1.6));
        flashModel(entity.model, this.time < entity.flashUntil);

        /* New arrivals pop up out of the ground with a little overshoot. */
        const age = (this.time - entity.born) / 0.4;
        if (age < 1) {
            const k = age - 1;
            entity.model.scale.setScalar(entity.baseScale * Math.max(0.001, 1 + 2.7 * k * k * k + 1.7 * k * k));
        } else if (entity.model.scale.x !== entity.baseScale) {
            entity.model.scale.setScalar(entity.baseScale);
        }

        pose(entity.model, {
            stride: entity.stride,
            moving: entity.moving,
            /* Offset each figure's clock so idle crowds don't breathe in step. */
            t: this.time + entity.seed,
            attack: (this.time - entity.attackStart) / 0.5,
            down: entity.down,
            hurt: entity.hurt,
        });
    }

    updateChunks() {
        /* Low cameras see to the horizon, so build out to where the fog ends. */
        const radius = this.scene.fog.far + 4;
        const cx = Math.floor(this.focus.x / CHUNK);
        const cy = Math.floor(this.focus.z / CHUNK);
        const reach = Math.ceil(radius / CHUNK);
        const cleared = new Map();
        (this.state?.cells || []).forEach((c) => {
            if (c.kind !== "stump" && c.kind !== "rubble") return;
            const key = `${Math.floor(c.x / CHUNK)}:${Math.floor(c.y / CHUNK)}`;
            if (!cleared.has(key)) cleared.set(key, []);
            cleared.get(key).push(`${c.x},${c.y}`);
        });

        const wanted = [];
        for (let y = cy - reach; y <= cy + reach; y += 1) {
            for (let x = cx - reach; x <= cx + reach; x += 1) {
                const mx = (x + 0.5) * CHUNK;
                const my = (y + 0.5) * CHUNK;
                const d = Math.hypot(mx - this.focus.x, my - this.focus.z);
                if (d > radius + CHUNK * 0.7) continue;
                const key = `${x}:${y}`;
                const list = cleared.get(key) || [];
                const signature = list.sort().join(";");
                const have = this.chunks.get(key);
                if (!have || have.signature !== signature) wanted.push({ key, x, y, d, list, signature });
            }
        }
        wanted.sort((a, b) => a.d - b.d);
        /* A couple of chunks a frame keeps walking smooth at the edge. */
        wanted.slice(0, this.chunks.size === 0 ? wanted.length : 2).forEach((w) => {
            const old = this.chunks.get(w.key);
            const group = buildChunk(w.x, w.y, new Set(w.list));
            this.scene.add(group);
            if (old) this.dropChunk(old);
            this.chunks.set(w.key, { group, signature: w.signature, x: w.x, y: w.y });
        });

        this.chunks.forEach((chunk, key) => {
            const d = Math.hypot((chunk.x + 0.5) * CHUNK - this.focus.x, (chunk.y + 0.5) * CHUNK - this.focus.z);
            if (d > radius + CHUNK * 2) {
                this.dropChunk(chunk);
                this.chunks.delete(key);
            }
        });
    }

    dropChunk(chunk) {
        this.scene.remove(chunk.group);
        chunk.group.traverse((node) => {
            if (node.geometry) node.geometry.dispose();
        });
    }

    updateLighting(dt) {
        const goal = PHASES[this.phaseName || "day"];
        const dimming = WEATHER_DIM[this.weather || "clear"];
        const k = Math.min(1, dt * 1.5);
        const p = this.phase;
        p.sun += (goal.sun * dimming - p.sun) * k;
        p.hemi += (goal.hemi * dimming - p.hemi) * k;
        p.angle += (goal.angle - p.angle) * k;
        p.sunColor.lerp(new THREE.Color(goal.sunColor), k);
        p.sky.lerp(new THREE.Color(goal.sky), k);
        p.ground.lerp(new THREE.Color(goal.ground), k);
        p.bg.lerp(new THREE.Color(goal.bg), k);

        let flash = 0;
        if (this.weather === "storm" && !this.reducedMotion) {
            this.nextFlash -= dt;
            if (this.nextFlash <= 0) {
                this.flash = 1;
                this.nextFlash = 5 + Math.random() * 9;
            }
            this.flash = Math.max(0, this.flash - dt * 4);
            flash = this.flash > 0.5 || (this.flash > 0.2 && this.flash < 0.3) ? 2.5 : 0;
        }

        this.sun.intensity = p.sun;
        this.sun.color.copy(p.sunColor);
        this.hemi.intensity = p.hemi + flash;
        this.hemi.color.copy(p.sky);
        this.hemi.groundColor.copy(p.ground);
        const fogFar = this.weather === "fog" ? this.distance * 1.6 + 8 : this.distance * 2.2 + 22;
        this.scene.fog.color.copy(p.bg);
        this.scene.fog.near = this.distance * (this.weather === "fog" ? 0.4 : 0.9);
        this.scene.fog.far = fogFar;
        this.renderer.setClearColor(this.scene.fog.color, glyphCode(0));
        /* Colours live in linear space; the ASCII pass writes sRGB. */
        this.quad.material.uniforms.uBackground.value.copy(p.bg).convertLinearToSRGB();
        this.quad.material.uniforms.uNear.value = this.camera.near;
        this.quad.material.uniforms.uFar.value = this.camera.far;

        /* The sun swings around a little with the time of day. */
        const a = p.angle;
        this.sun.position.set(this.focus.x - 10 * Math.cos(a), this.focus.y + 18 * Math.sin(a) + 4, this.focus.z + 8);
        this.sun.target.position.copy(this.focus);

        /* The nearest fires get real lights; there are only so many. */
        const lit = [];
        this.structures.forEach((s) => {
            const light = s.group.userData.light;
            if (!light) return;
            const d = s.group.position.distanceTo(this.focus);
            lit.push({ s, light, d });
        });
        lit.sort((x, y) => x.d - y.d);
        const night = this.phaseName === "night" ? 1.6 : this.phaseName === "day" ? 0.6 : 1.1;
        this.lightPool.forEach((light, i) => {
            const entry = lit[i];
            if (!entry) {
                light.intensity = 0;
                return;
            }
            const flicker = this.reducedMotion ? 1 : 0.85 + Math.sin(this.time * 13 + i * 3) * 0.08 + Math.sin(this.time * 7.3 + i) * 0.07;
            light.color.setHex(entry.light.color);
            light.distance = entry.light.range * 1.3;
            light.intensity = 4.5 * flicker * night;
            light.position.copy(entry.s.group.position);
            light.position.y += entry.light.y;
        });
    }

    updateCamera(dt) {
        const self = [...this.players.values()].find((p) => p.data.self);
        let goal;
        if (self) goal = self.pos;
        else if (this.state?.view) {
            goal = tmp.set(this.state.view.x + this.state.view.w / 2, 0, this.state.view.y + this.state.view.h / 2);
            goal.y = groundHeight(Math.round(goal.x), Math.round(goal.z));
        }
        if (goal) {
            if (!this.focusReady) {
                this.focus.copy(goal);
                this.focusReady = true;
            } else this.focus.lerp(goal, Math.min(1, dt * 8));
        }
        if (self && this.selfFacing !== null) {
            self.facing = this.selfFacing;
            this.selfFacing = null;
        }

        if (this.orbit) this.turnAngle = (this.turnAngle ?? 0) + dt * 0.08;
        const goalYaw = this.orbit ? this.turnAngle : (this.turn * Math.PI) / 2;
        this.yaw = this.orbit ? goalYaw : lerpAngle(this.yaw, goalYaw, Math.min(1, dt * 7));
        const ease = Math.min(1, dt * 6);
        this.distance += (ZOOMS[this.zoom] - this.distance) * ease;
        this.pitch = (this.pitch ?? PITCHES[this.zoom]) + (PITCHES[this.zoom] - (this.pitch ?? PITCHES[this.zoom])) * ease;

        /* Camera sits behind screen-down, looking toward screen-up. Close in
           it aims above your head, so you stand in the lower third. */
        const back = this.distance * Math.cos(this.pitch);
        const up = this.distance * Math.sin(this.pitch);
        const lift = 0.6 + (1 - this.pitch) * 1.2;
        const sx = -Math.sin(this.yaw);
        const sz = Math.cos(this.yaw);
        this.camera.position.set(this.focus.x + sx * back, this.focus.y + up + lift, this.focus.z + sz * back);
        this.camera.lookAt(this.focus.x, this.focus.y + lift, this.focus.z);

        this.water.position.x = Math.round(this.focus.x);
        this.water.position.z = Math.round(this.focus.z);
    }

    updateCursor() {
        if (!this.aim) {
            this.cursor.visible = false;
            return;
        }
        this.cursor.visible = true;
        const { x, y } = this.aim;
        const h = this.entityHeight(x, y);
        this.cursor.position.set(x, Math.max(h, WATER_LEVEL) + 0.01, y);
        const pulse = this.reducedMotion ? 1 : 1 + Math.sin(this.time * 6) * 0.04;
        this.cursor.scale.set(pulse, 1, pulse);
        this.cursor.children[0].material.color.setHex(this.aimOk ? 0xf3e6bd : 0xc0705a);
    }

    updateLabels() {
        const g = this.grid;
        const w = g.cols * g.cellW;
        const h = g.rows * g.cellH;
        this.labels.forEach((el, id) => {
            const entity = this.players.get(id);
            if (!entity) {
                el.style.visibility = "hidden";
                return;
            }
            tmp.copy(entity.pos);
            tmp.y += 1.85;
            tmp.project(this.camera);
            if (tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) {
                el.style.visibility = "hidden";
                return;
            }
            const left = (g.offX + ((tmp.x + 1) / 2) * w) / g.dpr;
            const top = (g.height - g.offY - ((tmp.y + 1) / 2) * h) / g.dpr;
            el.style.visibility = "visible";
            el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
        });
    }

    frame() {
        this.raf = requestAnimationFrame(this.frame);
        const dt = Math.min(0.1, this.clock.getDelta());
        this.time += dt;

        this.players.forEach((p) => this.updateEntity(p, dt));
        this.creatures.forEach((c) => this.updateEntity(c, dt));
        this.updateLeaving();
        this.updateCamera(dt);
        this.updateChunks();
        this.updateLighting(dt);
        this.updateRain(dt);
        this.updateSky(dt);
        this.updateEmbers();
        wind.uTime.value = this.reducedMotion ? 0 : this.time;
        this.updateCursor();

        this.structures.forEach((s) => {
            const hinge = s.group.userData.hinge;
            if (hinge) hinge.rotation.y += (-s.group.userData.open * Math.PI * 0.5 - hinge.rotation.y) * Math.min(1, dt * 10);
        });
        this.flames.forEach((f, i) => {
            const n = this.reducedMotion ? 0 : Math.sin(this.time * 11 + i * 1.7) * 0.12 + Math.sin(this.time * 17 + i) * 0.08;
            f.scale.y = f.scale.x * (1 + n);
            f.rotation.y = this.time * 1.5 + i;
        });
        if (!this.reducedMotion || !this.waterStill) {
            rippleWater(this.water, this.time, this.reducedMotion);
            this.waterStill = this.reducedMotion;
        }

        this.renderer.setRenderTarget(this.target);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.postScene, this.postCamera);
        this.updateLabels();
    }

    dispose() {
        cancelAnimationFrame(this.raf);
        this.observer.disconnect();
        this.chunks.forEach((c) => this.dropChunk(c));
        this.chunks.clear();
        if (this.target) {
            this.target.depthTexture.dispose();
            this.target.dispose();
        }
        if (this.atlas) this.atlas.texture.dispose();
        this.quad.material.dispose();
        disposeMaterials();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

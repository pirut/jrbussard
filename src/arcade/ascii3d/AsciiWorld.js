import * as THREE from "three";
import { CHUNK, WATER, tileAt } from "../../lib/terrain";
import { AsciiPass, glyphCode } from "./asciiPass";
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
import { CUT, ISO_BACK, ISO_YAW, aimCutaway, createIsoCamera, placeIsoCamera } from "./iso";

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
 * How much of the field fits on screen, top to bottom, in tiles, at each
 * zoom step. The camera is isometric (see iso.js), as in the survival games
 * this borrows its feel from: high off one corner, looking down at thirty
 * degrees, turned only a quarter at a time with [ and ]. Whatever stands
 * between it and you, trees and walls and hills, is cut down so you can
 * always see yourself.
 */
export const ZOOMS = [8, 11, 15, 21];
const NEAREST = 6;
const FARTHEST = 30;
const MAX_LIGHTS = 6;

/* Sky, sun and fill for each part of the day. Colours are sRGB hex. */
export const PHASES = {
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
        this.yaw = ISO_YAW;
        this.zoom = 1;
        this.distance = ZOOMS[1];
        this.distanceGoal = ZOOMS[1];
        this.yawGoal = ISO_YAW;
        this.shake = 0;
        this.predicted = null;
        this.floaters = [];
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
        /* Damage numbers and health bars ride on top, in the page's type. */
        this.fxLayer = document.createElement("div");
        this.fxLayer.className = "ascii3d__fx";
        container.appendChild(this.fxLayer);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x0b120d, 20, 40);
        this.camera = createIsoCamera();

        this.hemi = new THREE.HemisphereLight(0xd3e6ff, 0x4a5a3a, 1);
        this.scene.add(this.hemi);
        this.sun = new THREE.DirectionalLight(0xffffff, 2);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        this.sun.shadow.bias = -0.0015;
        const sc = this.sun.shadow.camera;
        sc.left = -28;
        sc.right = 28;
        sc.top = 28;
        sc.bottom = -28;
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
        this.sparks = this.createSparks();
        this.scene.add(this.sparks);
        this.scene.add(this.embers);

        /* The ASCII pass reads the offscreen render and draws characters. */
        this.ascii = new AsciiPass();

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

        this.ascii.setSize(this.grid);
        this.camera.userData.aspect = (cols * cellW) / (rows * cellH);
    }

    setCellSize(w, h) {
        this.cellCss = { w, h };
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

    /* Snap to a quarter turn, the nearest way round. */
    setTurn(turn) {
        this.turn = ((turn % 4) + 4) % 4;
        const goal = ISO_YAW + (this.turn * Math.PI) / 2;
        let d = goal - this.yawGoal;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yawGoal += d;
    }

    setZoom(zoom) {
        this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, zoom));
        this.distanceGoal = ZOOMS[this.zoom];
    }

    /* A quarter turn, one way or the other. The isometric view only ever
       stands at one of its four corners. */
    rotate(dyaw) {
        if (dyaw) this.yawGoal += Math.sign(dyaw) * (Math.PI / 2);
    }

    zoomBy(factor) {
        this.distanceGoal = Math.max(NEAREST, Math.min(FARTHEST, this.distanceGoal * factor));
    }

    /* The camera's turn, for turning keys into directions on the map
       (see iso.js). The goal, not the swing, so a held key keeps its way. */
    heading() {
        return this.yawGoal;
    }

    /* Move yourself at once, before the server confirms, so walking feels
       like walking. If the server disagrees for long, its answer wins. */
    predictSelf(x, y) {
        const self = this.selfEntity();
        if (!self) return;
        this.moveEntity(self, x, y, 0.17);
        this.predicted = { x, y, until: this.time + 0.9 };
    }

    selfEntity() {
        return [...this.players.values()].find((p) => p.data?.self) || null;
    }

    /* Words that rise off someone and fade: damage, gains, a level. */
    floatText(x, y, text, kind = "gain", lift = 1.9) {
        if (!this.fxLayer) return;
        const el = document.createElement("span");
        el.className = `ascii3d__float ascii3d__float--${kind}`;
        el.textContent = text;
        this.fxLayer.appendChild(el);
        const h = this.entityHeight(Math.round(x), Math.round(y));
        this.floaters.push({ el, x: x + (Math.random() - 0.5) * 0.4, y: h + lift, z: y, born: this.time });
    }

    floatSelf(text, kind = "gain") {
        const self = this.selfEntity();
        if (self) this.floatText(self.pos.x, self.pos.z, text, kind, 2.3);
    }

    setRaw(raw) {
        this.ascii.uniforms.uRaw.value = raw ? 1 : 0;
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
                entity.glide = true;
                entity.key = key;
                entity.facing = p.self ? Math.PI : 0;
                this.players.set(p.id, entity);
            }
            if (entity.data && p.hp < entity.data.hp) {
                this.hit(entity, entity.data.hp - p.hp, p.self ? "hurt" : "damage");
                if (p.self) this.shake = 0.35;
                /* Whatever bit them is probably standing next to them. */
                this.strikeFrom(this.creatures, entity);
            }
            entity.data = p;
            if (p.self && this.predicted) {
                /* Ours already went there; wait for the server to agree. */
                if (p.x === this.predicted.x && p.y === this.predicted.y) this.predicted = null;
                else if (this.time < this.predicted.until) return;
                else this.predicted = null;
            }
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
                    this.hit(entity, entity.data.hp - m.hp, "damage");
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

    hit(entity, amount = 0, kind = "damage") {
        entity.hurt = 1;
        entity.hurtAt = this.time;
        entity.flashUntil = this.time + 0.09;
        this.burst(entity.pos, entity.baseScale);
        if (amount > 0) this.floatText(entity.pos.x, entity.pos.z, `-${amount}`, kind, 1.4 * entity.baseScale + 0.5);
    }

    /* A spray of sparks where a blow lands. */
    burst(at, size = 1) {
        const seeds = this.sparks.userData.seeds;
        for (let n = 0; n < 8; n += 1) {
            const i = this.sparks.userData.next;
            this.sparks.userData.next = (i + 1) % seeds.length;
            const a = Math.random() * Math.PI * 2;
            const speed = 1.5 + Math.random() * 2;
            seeds[i] = {
                born: this.time,
                x: at.x,
                y: at.y + 0.8 * size,
                z: at.z,
                vx: Math.cos(a) * speed,
                vy: 1 + Math.random() * 2.5,
                vz: Math.sin(a) * speed,
            };
        }
    }

    createSparks() {
        const count = 48;
        const mesh = new THREE.InstancedMesh(
            new THREE.BoxGeometry(0.06, 0.06, 0.06),
            new THREE.MeshBasicMaterial({ color: 0xfff1c4, blending: THREE.NoBlending, transparent: false, opacity: glyphCode(4) }),
            count,
        );
        mesh.userData.seeds = Array.from({ length: count }, () => null);
        mesh.userData.next = 0;
        mesh.frustumCulled = false;
        return mesh;
    }

    updateSparks() {
        const mesh = this.sparks;
        const m = new THREE.Matrix4();
        let any = false;
        mesh.userData.seeds.forEach((s, i) => {
            const t = s ? this.time - s.born : 1;
            if (!s || t > 0.35) {
                m.makeScale(0, 0, 0);
            } else {
                any = true;
                const size = 1 - t / 0.35;
                m.makeScale(size, size, size).setPosition(s.x + s.vx * t, s.y + s.vy * t - 6 * t * t, s.z + s.vz * t);
            }
            mesh.setMatrixAt(i, m);
        });
        mesh.visible = any;
        mesh.instanceMatrix.needsUpdate = true;
    }

    /* Creatures' health, as a little bar of characters over the hurt. */
    updateBars() {
        const g = this.grid;
        const w = g.cols * g.cellW;
        const h = g.rows * g.cellH;
        this.creatures.concat(this.leaving.filter((e) => e.bar)).forEach((e) => {
            const data = e.data;
            const show = data && data.maxHp && data.hp < data.maxHp && data.hp > 0 && !e.leftAt;
            if (!show) {
                if (e.bar) e.bar.style.visibility = "hidden";
                return;
            }
            if (!e.bar) {
                e.bar = document.createElement("span");
                e.bar.className = "ascii3d__bar";
                this.fxLayer.appendChild(e.bar);
            }
            const filled = Math.max(1, Math.round((data.hp / data.maxHp) * 8));
            const text = `${"#".repeat(filled)}${"-".repeat(8 - filled)}`;
            if (e.bar.dataset.text !== text) {
                e.bar.dataset.text = text;
                e.bar.textContent = `[${text}]`;
            }
            tmp.copy(e.pos);
            tmp.y += 1.3 * e.baseScale + 0.4;
            tmp.project(this.camera);
            if (tmp.z > 1 || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) {
                e.bar.style.visibility = "hidden";
                return;
            }
            e.bar.style.visibility = "visible";
            e.bar.style.transform = `translate(${((g.offX + ((tmp.x + 1) / 2) * w) / g.dpr).toFixed(1)}px, ${((g.height - g.offY - ((tmp.y + 1) / 2) * h) / g.dpr).toFixed(1)}px)`;
        });
    }

    updateFloaters() {
        const g = this.grid;
        const w = g.cols * g.cellW;
        const h = g.rows * g.cellH;
        this.floaters = this.floaters.filter((f) => {
            const t = this.time - f.born;
            if (t > 1.1) {
                f.el.remove();
                return false;
            }
            tmp.set(f.x, f.y + t * 0.9, f.z).project(this.camera);
            const left = (g.offX + ((tmp.x + 1) / 2) * w) / g.dpr;
            const top = (g.height - g.offY - ((tmp.y + 1) / 2) * h) / g.dpr;
            f.el.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.4);
            f.el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px) scale(${t < 0.1 ? 1 + (0.1 - t) * 6 : 1})`;
            return true;
        });
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
        /* Something that was just being hit has been killed, not wandered
           off: let it fall before it goes. */
        const self = this.selfEntity();
        const struckBySelf =
            self && this.time - self.attackStart < 0.8 && Math.hypot(self.to.x - entity.to.x, self.to.y - entity.to.y) < 1.6;
        entity.slain = (entity.hurtAt !== undefined && this.time - entity.hurtAt < 1.5) || Boolean(struckBySelf);
        if (entity.slain && entity.data) entity.data = { ...entity.data, hp: 0 };
        if (entity.bar) entity.bar.remove();
        entity.bar = null;
        this.leaving.push(entity);
    }

    updateLeaving(dt) {
        this.leaving = this.leaving.filter((e) => {
            const linger = e.slain ? 0.8 : 0;
            const age = this.time - e.leftAt;
            if (e.slain) this.updateEntity(e, dt);
            if (age < linger) return true;
            const k = (age - linger) / 0.45;
            if (k >= 1) {
                this.scene.remove(e.model);
                return false;
            }
            const scale = e.baseScale * (1 - k * k);
            e.model.scale.setScalar(Math.max(0.001, scale));
            if (!e.slain) e.model.rotation.y += 0.25;
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
        const u = this.ascii.uniforms;
        u.uTime.value = this.time;
        u.uRain.value = on ? (this.weather === "storm" ? 1 : 0.6) : 0;
    }

    /* Stars and cloud for the ASCII pass to draw where nothing else is. */
    updateSky(dt) {
        const u = this.ascii.uniforms;
        const stars = { night: 1, dusk: 0.45, dawn: 0.3, day: 0 }[this.phaseName || "day"];
        const clouds = { clear: 0.15, fog: 0.5, rain: 0.75, storm: 1 }[this.weather || "clear"];
        const k = Math.min(1, dt * 0.8);
        u.uStars.value += (stars * (1 - clouds * 0.6) - u.uStars.value) * k;
        u.uClouds.value += (clouds - u.uClouds.value) * k;
        const day = this.phaseName === "day" || this.phaseName === "dawn";
        const tint = new THREE.Color(day ? 0x3c4a66 : 0x283350);
        if (this.flash > 0.2) tint.setHex(0x8f9fd0);
        u.uCloudColor.value.lerp(tint, this.flash > 0.2 ? 1 : k);
        /* Turning the camera slides the sky along. */
        u.uSkyShift.value = (-this.yaw / 1.4) * this.grid.cols;
    }

    updateEntity(entity, dt) {
        const t = entity.duration > 0 ? Math.min(1, (this.time - entity.start) / entity.duration) : 1;
        const x = entity.from.x + (entity.to.x - entity.from.x) * t;
        const z = entity.from.y + (entity.to.y - entity.from.y) * t;
        const moved = Math.hypot(x - entity.pos.x, z - entity.pos.z);
        const fromH = this.entityHeight(entity.from.x, entity.from.y);
        const toH = this.entityHeight(entity.to.x, entity.to.y);
        const h = fromH + (toH - fromH) * t + Math.sin(t * Math.PI) * (Math.abs(toH - fromH) > 0.05 ? 0.12 : 0);
        if (entity.glide) {
            /*
             * People glide. The server moves everyone a whole tile at a time,
             * along the grid, so a diagonal arrives as a zigzag; easing
             * toward each step instead of landing on it smooths the zigzag
             * into the straight line that was meant, and the body turns to
             * the way it is really going.
             */
            const k = 1 - Math.exp(-dt * 13);
            const gx = entity.pos.x + (x - entity.pos.x) * k;
            const gz = entity.pos.z + (z - entity.pos.z) * k;
            const vx = gx - entity.pos.x;
            const vz = gz - entity.pos.z;
            if (Math.hypot(vx, vz) > dt * 0.8) entity.facing = Math.atan2(vx, vz);
            entity.pos.set(gx, h, gz);
        } else entity.pos.set(x, h, z);
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
        /* Enough to fill the screen at the widest zoom, and the hills just
           below it. */
        const radius = this.distance * 1.3 + 18;
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
        /* Measured from where the isometric camera hangs, so the haze
           thickens toward the top of the screen, further off. */
        const fog = this.weather === "fog";
        this.scene.fog.color.copy(p.bg);
        this.scene.fog.near = ISO_BACK + this.distance * (fog ? -0.4 : 0.3);
        this.scene.fog.far = ISO_BACK + this.distance * (fog ? 0.9 : 2.4) + (fog ? 4 : 12);
        this.renderer.setClearColor(this.scene.fog.color, glyphCode(0));
        /* Colours live in linear space; the ASCII pass writes sRGB. */
        this.ascii.uniforms.uBackground.value.copy(p.bg).convertLinearToSRGB();
        /* A wash of each cell's colour behind its character, so shapes read
           as masses at a glance; more at night, when the type is thinner. */
        this.ascii.uniforms.uFill.value = this.phaseName === "night" ? 0.6 : 0.52;
        this.ascii.uniforms.uGlow.value = this.phaseName === "night" ? 1.2 : 0.5;
        /* Flat walls thin out as they darken, so cabins read as timber
           rather than as slabs of # and %. */
        this.ascii.uniforms.uContrast.value = 1.7;
        this.ascii.uniforms.uNear.value = this.camera.near;
        this.ascii.uniforms.uFar.value = this.camera.far;

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

        if (this.orbit) this.turnAngle = (this.turnAngle ?? ISO_YAW) + dt * 0.08;
        const goalYaw = this.orbit ? this.turnAngle : this.yawGoal;
        this.yaw = this.orbit ? goalYaw : lerpAngle(this.yaw, goalYaw, Math.min(1, dt * 8));
        this.distance += (this.distanceGoal - this.distance) * Math.min(1, dt * 8);

        placeIsoCamera(this.camera, this.focus, this.yaw, this.distance, this.camera.userData.aspect || 1.6);
        if (this.shake > 0 && !this.reducedMotion) {
            this.shake = Math.max(0, this.shake - dt);
            const k = this.shake * 0.35;
            this.camera.position.x += (Math.random() - 0.5) * k;
            this.camera.position.y += (Math.random() - 0.5) * k;
            this.camera.updateMatrixWorld();
        }
        /* Cut away whatever stands between the camera and you. */
        aimCutaway(this.camera, self ? self.pos : this.focus, { on: Boolean(self) && !this.orbit, width: 2.4 + this.distance * 0.12, height: 2.2 + this.distance * 0.1 });

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
            tmp.y += 2.0;
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
        this.updateLeaving(dt);
        this.updateSparks();
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

        this.renderer.setRenderTarget(this.ascii.target);
        this.renderer.render(this.scene, this.camera);
        this.ascii.uniforms.uFlash.value = this.flash > 0.2 ? 1 : 0;
        this.ascii.uniforms.uOrtho.value = 1;
        this.ascii.uniforms.uInvProj.value.copy(this.camera.projectionMatrixInverse);
        this.ascii.uniforms.uCamToWorld.value.copy(this.camera.matrixWorld);
        this.ascii.render(this.renderer);
        this.updateLabels();
        this.updateBars();
        this.updateFloaters();
    }

    dispose() {
        cancelAnimationFrame(this.raf);
        CUT.uCutOn.value = 0;
        this.observer.disconnect();
        this.chunks.forEach((c) => this.dropChunk(c));
        this.chunks.clear();
        this.ascii.dispose();
        this.fxLayer.remove();
        disposeMaterials();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

import * as THREE from "three";
import { AsciiPass, glyphCode } from "../arcade/ascii3d/asciiPass";
import { disposeMaterials } from "../arcade/ascii3d/materials";
import { buildSurvivor, buildCursor, pose } from "../arcade/ascii3d/models";
import { Batch, P, place, tint, hash, addTree, addRock, addBlades, createWater, rippleWater, wind, WATER_LEVEL } from "../arcade/ascii3d/terrainMesh";
import { PHASES } from "../arcade/ascii3d/AsciiWorld";
import { KIND } from "../world/tiles";
import { fbm } from "../lib/noise";
import { buildProp, buildTorch, disposeProps } from "./props";

/*
 * The workshop, in 3D, drawn in characters.
 *
 * The site has always been a tile world (see world/build.js): rooms, roads,
 * woods and the props you walk up to. The Commons showed that a tile world
 * can be modelled in 3D and still read as type, so this does for the
 * workshop what AsciiWorld does for the Commons — same ASCII pass, same
 * materials, the same jointed figures — over the same grid the 2D renderer
 * draws. Walking, collisions and what each prop opens all stay in World.js;
 * this only draws them.
 */

const CHUNK = 16;
const SEABED = -0.7;
const ROOM_FLOOR = 0.1;
const ROAD = 0.05;

/* Camera distance and pitch at each zoom step. The workshop is read at room
   scale, so even the closest step keeps most of a room in view. */
export const ZOOMS = [11, 15, 20, 28];
const PITCHES = [0.6, 0.72, 0.84, 0.98];
const INTRO = { distance: 34, pitch: 0.92 };
const FOV = 44;
const MAX_LIGHTS = 8;

/* JR, as a survivor from the Commons. */
const JR = {
    appearance: { skin: "sand", hair: "chestnut", outfit: "tide", cloak: "sea", hairstyle: "cropped", headwear: "none" },
};

const tmp = new THREE.Vector3();

function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

function pitchFor(distance) {
    if (distance <= ZOOMS[0]) return PITCHES[0];
    for (let i = 1; i < ZOOMS.length; i += 1) {
        if (distance <= ZOOMS[i]) {
            const k = (distance - ZOOMS[i - 1]) / (ZOOMS[i] - ZOOMS[i - 1]);
            return PITCHES[i - 1] + (PITCHES[i] - PITCHES[i - 1]) * k;
        }
    }
    const k = Math.min(1, (distance - ZOOMS[ZOOMS.length - 1]) / (INTRO.distance - ZOOMS[ZOOMS.length - 1]));
    return PITCHES[PITCHES.length - 1] + (INTRO.pitch - PITCHES[PITCHES.length - 1]) * k;
}

function mix(a, b, k) {
    return new THREE.Color(a).lerp(new THREE.Color(b), k);
}

function rgbHex(rgb) {
    return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255).getHexString();
}

export default class SiteScene {
    constructor(container, world, { cellWidth = 6, cellHeight = 10, reducedMotion = false, phase = "dusk" } = {}) {
        this.container = container;
        this.world = world;
        this.reducedMotion = reducedMotion;
        this.cellCss = { w: cellWidth, h: cellHeight };
        this.phaseName = PHASES[phase] ? phase : "dusk";
        this.time = 0;
        this.clock = new THREE.Clock();
        this.mode = "intro";
        this.zoom = 1;
        this.distance = INTRO.distance;
        this.distanceGoal = INTRO.distance;
        this.yaw = 0.6;
        this.focus = new THREE.Vector3(world.spawn.x, 0, world.spawn.y - 4);
        this.counts = {};
        this.highlight = null;
        this.chunks = new Map();
        this.labels = [];

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
        this.renderer.setPixelRatio(1);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        const canvas = this.renderer.domElement;
        canvas.className = "site3d__canvas";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        container.appendChild(canvas);
        this.labelLayer = document.createElement("div");
        this.labelLayer.className = "site3d__labels";
        container.appendChild(this.labelLayer);

        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x0b120d, 30, 60);
        this.camera = new THREE.PerspectiveCamera(FOV, 2, 0.5, 160);

        const p = PHASES[this.phaseName];
        this.hemi = new THREE.HemisphereLight(p.sky, p.ground, p.hemi);
        this.sun = new THREE.DirectionalLight(p.sunColor, p.sun);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        this.sun.shadow.bias = -0.0015;
        const sc = this.sun.shadow.camera;
        sc.left = -30;
        sc.right = 30;
        sc.top = 30;
        sc.bottom = -30;
        sc.near = 1;
        sc.far = 90;
        this.scene.add(this.hemi, this.sun, this.sun.target);
        this.lightPool = [];
        for (let i = 0; i < MAX_LIGHTS; i += 1) {
            const light = new THREE.PointLight(0xffb46b, 0, 8, 1.2);
            this.scene.add(light);
            this.lightPool.push(light);
        }

        this.water = createWater(110);
        this.water.position.y = WATER_LEVEL;
        this.scene.add(this.water);

        this.buildProps();
        this.buildLabels();

        this.player = buildSurvivor(JR);
        this.player.scale.setScalar(1.25);
        this.scene.add(this.player);
        this.walker = {
            from: { ...world.spawn },
            to: { ...world.spawn },
            start: 0,
            duration: 0.12,
            facing: Math.PI,
            yaw: Math.PI,
            stride: 0,
            moving: 0,
            lastStep: -10,
        };
        this.player.position.set(world.spawn.x, this.standHeight(world.spawn.x, world.spawn.y), world.spawn.y);

        this.cursor = buildCursor();
        this.cursor.visible = false;
        this.cursor.scale.setScalar(1.2);
        this.scene.add(this.cursor);

        this.ascii = new AsciiPass();

        this.resize = this.resize.bind(this);
        this.frame = this.frame.bind(this);
        this.observer = new ResizeObserver(this.resize);
        this.observer.observe(container);
        this.resize();
        /* Draw one frame straight away so a WebGL failure shows up here, in
           the constructor, where the caller can fall back. */
        this.frame();
    }

    /* ── Ground ─────────────────────────────────────────────────────────── */

    roomOf(x, y) {
        const zone = this.world.zones[y * this.world.w + x];
        return zone ? this.world.rooms[zone - 1] : null;
    }

    /* Height of the ground at a tile, or null where there is only sea. */
    groundAt(x, y) {
        const kind = this.world.kindAt(x, y);
        if (kind === KIND.VOID || kind === KIND.STAR || kind === KIND.WATER) return null;
        if (this.roomOf(x, y)) return ROOM_FLOOR;
        if (kind === KIND.FLOOR) return ROAD;
        return 0;
    }

    standHeight(x, y) {
        const h = this.groundAt(x, y);
        return h === null ? WATER_LEVEL : h;
    }

    isBorder(room, x, y) {
        return x === room.x || y === room.y || x === room.x + room.w - 1 || y === room.y + room.h - 1;
    }

    buildChunk(cx, cy) {
        const world = this.world;
        const batch = new Batch();
        const x0 = cx * CHUNK;
        const y0 = cy * CHUNK;
        for (let y = y0; y < Math.min(world.h, y0 + CHUNK); y += 1) {
            for (let x = x0; x < Math.min(world.w, x0 + CHUNK); x += 1) {
                const h = this.groundAt(x, y);
                if (h === null) continue;
                const kind = world.kindAt(x, y);
                const room = this.roomOf(x, y);
                const lush = fbm(x, y, 0.055, 7);
                let set = "grass";
                let top;
                if (room) {
                    set = "path";
                    /* Flagstones, kept dark so the floor reads as open
                       ground and what stands on it carries the picture. */
                    const flag = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 0.85 : 1;
                    top = mix("#4b4a42", `#${rgbHex(room.tint)}`, 0.22).multiplyScalar(flag * (0.88 + hash(x, y, 3) * 0.14));
                } else if (kind === KIND.FLOOR) {
                    set = "path";
                    top = tint("#6d6553", 0.86 + hash(x, y, 4) * 0.2).clone();
                } else if (kind === KIND.MOUNTAIN) {
                    set = "rock";
                    top = tint("#6f7684", 0.9).clone();
                } else {
                    top = tint(lush < 0.42 ? "#4a5a38" : "#3d5f36", 0.88 + hash(x, y, 5) * 0.14).clone();
                }
                batch.quad(set, [x - 0.5, h, y - 0.5], [x - 0.5, h, y + 0.5], [x + 0.5, h, y + 0.5], [x + 0.5, h, y - 0.5], top);

                /* Banks and steps wherever the neighbour sits lower. */
                const bank = tint(room ? "#6d6858" : "#6b5d45", 0.8).clone();
                [
                    [0, 1, [x - 0.5, y + 0.5], [x + 0.5, y + 0.5]],
                    [0, -1, [x + 0.5, y - 0.5], [x - 0.5, y - 0.5]],
                    [1, 0, [x + 0.5, y + 0.5], [x + 0.5, y - 0.5]],
                    [-1, 0, [x - 0.5, y - 0.5], [x - 0.5, y + 0.5]],
                ].forEach(([dx, dy, a, b]) => {
                    const n = this.groundAt(x + dx, y + dy);
                    const nh = n === null ? SEABED : n;
                    if (nh >= h) return;
                    batch.quad(h - nh > 0.3 ? "rock" : set, [a[0], h, a[1]], [a[0], nh, a[1]], [b[0], nh, b[1]], [b[0], h, b[1]], bank);
                });

                if (kind === KIND.WALL && room) {
                    if (this.isBorder(room, x, y)) {
                        /* Room walls: tinted stone with a timber cap. */
                        const stone = mix("#8f978f", `#${rgbHex(room.tint)}`, 0.3).multiplyScalar(0.85 + hash(x, y, 6) * 0.2);
                        batch.shape("rock", P.cube(), place(x, h + 0.5, y, 1, 1.0, 1), stone);
                        batch.shape("timber", P.cube(), place(x, h + 1.04, y, 1.04, 0.08, 1.04), tint("#7a5a3c", 1));
                    } else {
                        /* Inside, the same tiles are furniture: cases,
                           counters, the housings of machines. */
                        const wood = mix("#a07850", `#${rgbHex(room.tint)}`, 0.15).multiplyScalar(0.85 + hash(x, y, 7) * 0.15);
                        batch.shape("timber", P.cube(), place(x, h + 0.42, y, 0.98, 0.84, 0.98), wood);
                    }
                } else if (kind === KIND.TREE) {
                    addBlades(batch, x, y, h, 3, 0.8);
                    addTree(batch, x, y, h);
                } else if (kind === KIND.MOUNTAIN) {
                    addRock(batch, x, y, h, null);
                    if (hash(x, y, 8) < 0.5) batch.shape("rock", P.boulder(), place(x + 0.1, h + 0.85, y, 0.7, 0.6, 0.7, hash(x, y, 9) * 6), tint("#8a8f88", 0.9));
                } else if (kind === KIND.GRASS) {
                    addBlades(batch, x, y, h, lush < 0.42 ? 1 : 4, 1);
                }
            }
        }
        const group = new THREE.Group();
        batch.meshes().forEach((m) => group.add(m));
        return group;
    }

    updateChunks(all = false) {
        const reach = this.scene.fog.far + CHUNK;
        const wanted = [];
        const cols = Math.ceil(this.world.w / CHUNK);
        const rows = Math.ceil(this.world.h / CHUNK);
        for (let cy = 0; cy < rows; cy += 1) {
            for (let cx = 0; cx < cols; cx += 1) {
                const key = `${cx}:${cy}`;
                if (this.chunks.has(key)) continue;
                const d = Math.hypot((cx + 0.5) * CHUNK - this.focus.x, (cy + 0.5) * CHUNK - this.focus.z);
                if (d < reach || all) wanted.push({ key, cx, cy, d });
            }
        }
        wanted.sort((a, b) => a.d - b.d);
        /* A few a frame keeps the first frames quick; the rest fill in. */
        wanted.slice(0, all ? wanted.length : 3).forEach(({ key, cx, cy }) => {
            const group = this.buildChunk(cx, cy);
            this.scene.add(group);
            this.chunks.set(key, group);
        });
    }

    /* ── Props and labels ───────────────────────────────────────────────── */

    buildProps() {
        this.props = [];
        this.world.markers.forEach((marker) => {
            const prop = buildProp(marker);
            if (!prop) return;
            prop.group.position.set(marker.x, this.standHeight(marker.x, marker.y), marker.y);
            prop.marker = marker;
            prop.seed = hash(marker.x, marker.y, 1) * 6;
            this.scene.add(prop.group);
            this.props.push(prop);
        });
        this.torches = this.world.torches.map(({ x, y }) => {
            const g = buildTorch();
            g.position.set(x, this.standHeight(x, y), y);
            this.scene.add(g);
            const flames = [];
            g.traverse((node) => {
                if (node.userData.flame) flames.push(node);
            });
            return { group: g, flames, light: g.userData.light };
        });
    }

    /* The words written on the floor of each room in the character world
       float over it here, in the page's own type, so they stay readable. */
    buildLabels() {
        this.world.rooms.forEach((room) => {
            const el = document.createElement("span");
            el.className = "site3d__label site3d__label--room";
            el.textContent = room.name;
            el.style.setProperty("--tint", `#${rgbHex(room.tint)}`);
            this.labelLayer.appendChild(el);
            this.labels.push({ el, x: room.x + room.w / 2 - 0.5, y: 1.6, z: room.y + room.h / 2, room: true });
            (room.content || []).forEach((item, i) => {
                if (item.text === undefined || i === 0) return;
                /* The first text in a room is its own name, already shown. */
                if (item.text === room.name) return;
                const label = document.createElement("span");
                label.className = "site3d__label";
                label.textContent = item.text;
                this.labelLayer.appendChild(label);
                this.labels.push({ el: label, x: room.x + item.x + item.text.length / 2 - 0.5, y: ROOM_FLOOR + 0.05, z: room.y + item.y });
            });
        });
    }

    updateLabels() {
        const g = this.grid;
        const w = g.cols * g.cellW;
        const h = g.rows * g.cellH;
        const intro = this.mode === "intro";
        this.labels.forEach((label) => {
            const d = Math.hypot(label.x - this.focus.x, label.z - this.focus.z);
            /* Room names mark rooms you are not in; the floor text belongs
               to the room around you. The front door shows neither, so the
               title has the picture to itself. */
            const show = !intro && (label.room ? d > 12 : d < 16);
            const opacity = label.room ? Math.min(1, (d - 12) / 6) : Math.min(1, (16 - d) / 4);
            if (!show || opacity <= 0) {
                if (label.shown) {
                    label.el.style.visibility = "hidden";
                    label.shown = false;
                }
                return;
            }
            tmp.set(label.x, label.room ? 2.6 : label.y, label.z).project(this.camera);
            if (tmp.z > 1 || Math.abs(tmp.x) > 1.1 || Math.abs(tmp.y) > 1.1) {
                label.el.style.visibility = "hidden";
                label.shown = false;
                return;
            }
            label.shown = true;
            label.el.style.visibility = "visible";
            label.el.style.opacity = opacity.toFixed(2);
            label.el.style.transform = `translate(${((g.offX + ((tmp.x + 1) / 2) * w) / g.dpr).toFixed(1)}px, ${((g.height - g.offY - ((tmp.y + 1) / 2) * h) / g.dpr).toFixed(1)}px)`;
        });
    }

    /* ── Inputs from React ─────────────────────────────────────────────── */

    setMode(mode) {
        this.mode = mode;
        this.distanceGoal = mode === "intro" ? INTRO.distance : ZOOMS[this.zoom];
    }

    setPlayer({ x, y }, { snap = false } = {}) {
        const w = this.walker;
        if (w.to.x === x && w.to.y === y) return;
        const far = snap || Math.hypot(w.to.x - x, w.to.y - y) > 2.5;
        if (!far) {
            w.facing = Math.atan2(x - w.to.x, y - w.to.y);
            const gap = this.time - w.lastStep;
            w.duration = gap < 0.4 ? Math.min(Math.max(gap, 0.09), 0.2) : 0.12;
            w.lastStep = this.time;
        }
        w.from = far ? { x, y } : { x: this.player.position.x, y: this.player.position.z };
        w.to = { x, y };
        w.start = this.time;
        if (far) {
            this.player.position.set(x, this.standHeight(x, y), y);
            this.focus.set(x, this.player.position.y, y);
        }
    }

    setZoom(zoom) {
        this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, zoom));
        if (this.mode !== "intro") this.distanceGoal = ZOOMS[this.zoom];
        return this.zoom;
    }

    setCounts(counts) {
        this.counts = counts || {};
    }

    /* The prop you are standing beside, bracketed like the Commons' aim. */
    setHighlight(marker) {
        this.highlight = marker;
    }

    setRaw(raw) {
        this.ascii.uniforms.uRaw.value = raw ? 1 : 0;
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
        this.grid = { dpr, width, height, cellW, cellH, cols, rows, offX: Math.floor((width - cols * cellW) / 2), offY: Math.floor((height - rows * cellH) / 2) };
        this.renderer.setSize(width, height, false);
        this.ascii.setSize(this.grid);
        this.camera.aspect = (cols * cellW) / (rows * cellH);
        this.camera.updateProjectionMatrix();
    }

    /* ── Per frame ─────────────────────────────────────────────────────── */

    updatePlayer(dt) {
        const w = this.walker;
        const t = w.duration > 0 ? Math.min(1, (this.time - w.start) / w.duration) : 1;
        const x = w.from.x + (w.to.x - w.from.x) * t;
        const z = w.from.y + (w.to.y - w.from.y) * t;
        const moved = Math.hypot(x - this.player.position.x, z - this.player.position.z);
        const h = this.standHeight(Math.round(x), Math.round(z));
        this.player.position.set(x, h, z);
        const walking = this.time - w.lastStep < 0.26;
        w.moving += ((walking ? 1 : 0) - w.moving) * Math.min(1, dt * 12);
        w.stride += moved * 4.6;
        w.yaw = lerpAngle(w.yaw, w.facing, Math.min(1, dt * 14));
        this.player.rotation.y = w.yaw;
        this.player.visible = this.mode !== "intro";
        pose(this.player, { stride: w.stride, moving: w.moving, t: this.time });
    }

    updateCamera(dt) {
        const intro = this.mode === "intro";
        const goal = intro ? tmp.set(this.world.spawn.x, 0, this.world.spawn.y - 4) : this.player.position;
        this.focus.lerp(goal, Math.min(1, dt * (intro ? 0.8 : 7)));
        if (intro && !this.reducedMotion) this.yaw += dt * 0.05;
        else if (!intro) this.yaw = lerpAngle(this.yaw, 0, Math.min(1, dt * 2.5));
        this.distance += (this.distanceGoal - this.distance) * Math.min(1, dt * (intro ? 1.5 : 3.5));
        const pitch = pitchFor(this.distance);
        const back = this.distance * Math.cos(pitch);
        const up = this.distance * Math.sin(pitch);
        const sx = -Math.sin(this.yaw);
        const sz = Math.cos(this.yaw);
        this.camera.position.set(this.focus.x + sx * back, this.focus.y + up + 0.8, this.focus.z + sz * back);
        this.camera.lookAt(this.focus.x, this.focus.y + 0.8, this.focus.z);
        this.water.position.x = Math.round(this.focus.x);
        this.water.position.z = Math.round(this.focus.z);
    }

    updateLighting() {
        const p = PHASES[this.phaseName];
        const bg = new THREE.Color(p.bg);
        this.sun.intensity = p.sun;
        this.sun.color.set(p.sunColor);
        /* A touch brighter than the Commons: this is a site to read. */
        this.hemi.intensity = p.hemi + (this.phaseName === "night" ? 0.3 : 0.18);
        this.hemi.color.set(p.sky);
        this.hemi.groundColor.set(p.ground);
        this.scene.fog.color.copy(bg);
        this.scene.fog.near = this.distance * 0.9;
        this.scene.fog.far = this.distance * 2.1 + (this.mode === "intro" ? 34 : 20);
        this.renderer.setClearColor(bg, glyphCode(0));
        this.ascii.uniforms.uBackground.value.copy(bg).convertLinearToSRGB();
        this.ascii.uniforms.uNear.value = this.camera.near;
        this.ascii.uniforms.uFar.value = this.camera.far;
        const a = p.angle;
        this.sun.position.set(this.focus.x - 14 * Math.cos(a), this.focus.y + 24 * Math.sin(a) + 4, this.focus.z + 10);
        this.sun.target.position.copy(this.focus);

        /* Torches and lit props near you get the real lights. */
        const lit = [];
        this.torches.forEach((t) => lit.push({ pos: t.group.position, light: t.light, d: t.group.position.distanceTo(this.focus) }));
        this.props.forEach((prop) => {
            if (prop.light && prop.lit) lit.push({ pos: prop.group.position, light: prop.light, d: prop.group.position.distanceTo(this.focus) });
        });
        lit.sort((x, y) => x.d - y.d);
        const night = this.phaseName === "night" ? 1.6 : this.phaseName === "day" ? 0.6 : 1.1;
        this.lightPool.forEach((light, i) => {
            const entry = lit[i];
            if (!entry) {
                light.intensity = 0;
                return;
            }
            const flicker = this.reducedMotion ? 1 : 0.88 + Math.sin(this.time * 13 + i * 3) * 0.07 + Math.sin(this.time * 7.3 + i) * 0.05;
            light.color.setHex(entry.light.color);
            light.distance = entry.light.range * 1.3;
            light.intensity = 4 * flicker * night;
            light.position.copy(entry.pos);
            light.position.y += entry.light.y;
        });
    }

    updateSky() {
        const u = this.ascii.uniforms;
        u.uTime.value = this.time;
        u.uStars.value = { night: 1, dusk: 0.5, dawn: 0.3, day: 0 }[this.phaseName];
        u.uClouds.value = 0.2;
        u.uCloudColor.value.setHex(this.phaseName === "day" ? 0x3c4a66 : 0x283350);
        const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect);
        u.uSkyShift.value = (-this.yaw / hfov) * this.grid.cols;
    }

    updateProps() {
        const t = this.reducedMotion ? 0 : this.time;
        this.props.forEach((prop) => {
            const { marker } = prop;
            const capacity = this.counts[marker.kind];
            prop.lit = capacity === undefined ? true : marker.index < capacity;
            prop.update(t, prop.lit, prop.seed);
        });
        this.torches.forEach((torch, i) => {
            torch.flames.forEach((f) => {
                const n = this.reducedMotion ? 0 : Math.sin(this.time * 11 + i * 1.7) * 0.12 + Math.sin(this.time * 17 + i) * 0.08;
                f.scale.y = f.scale.x * (1 + n);
                f.rotation.y = this.time * 1.5 + i;
            });
        });
        const m = this.highlight;
        this.cursor.visible = Boolean(m) && this.mode !== "intro";
        if (m) {
            this.cursor.position.set(m.x, this.standHeight(m.x, m.y) + 0.02, m.y);
            const pulse = this.reducedMotion ? 1.2 : 1.2 + Math.sin(this.time * 6) * 0.05;
            this.cursor.scale.set(pulse, 1, pulse);
        }
    }

    frame() {
        this.raf = requestAnimationFrame(this.frame);
        const dt = Math.min(0.1, this.clock.getDelta());
        this.time += dt;
        this.updatePlayer(dt);
        this.updateCamera(dt);
        this.updateLighting();
        this.updateChunks();
        this.updateProps();
        this.updateSky();
        wind.uTime.value = this.reducedMotion ? 0 : this.time;
        if (!this.reducedMotion || !this.waterStill) {
            rippleWater(this.water, this.time, this.reducedMotion);
            this.waterStill = this.reducedMotion;
        }
        this.renderer.setRenderTarget(this.ascii.target);
        this.renderer.render(this.scene, this.camera);
        this.ascii.render(this.renderer);
        this.updateLabels();
    }

    dispose() {
        cancelAnimationFrame(this.raf);
        this.observer.disconnect();
        this.chunks.forEach((group) => {
            this.scene.remove(group);
            group.traverse((node) => {
                if (node.geometry) node.geometry.dispose();
            });
        });
        this.chunks.clear();
        this.props.forEach((prop) => disposeProps(prop.group));
        this.torches.forEach((t) => disposeProps(t.group));
        this.ascii.dispose();
        this.labelLayer.remove();
        disposeMaterials();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

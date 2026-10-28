import * as THREE from "three";
import { AsciiPass, glyphCode } from "../arcade/ascii3d/asciiPass";
import { disposeMaterials } from "../arcade/ascii3d/materials";
import { buildSurvivor, buildCursor, pose } from "../arcade/ascii3d/models";
import { Batch, P, place, tint, hash, createWater, rippleWater, wind, WATER_LEVEL } from "../arcade/ascii3d/terrainMesh";
import { streetlamp } from "../arcade/ascii3d/architecture";
import { PHASES } from "../arcade/ascii3d/AsciiWorld";
import { CUT, ISO_BACK, ISO_YAW, aimCutaway, createIsoCamera, placeIsoCamera, snapIsoCamera } from "../arcade/ascii3d/iso";
import { PerfOverlay, perfEnabled } from "../arcade/ascii3d/perf";
import { KIND } from "../world/tiles";
import { fbm } from "../lib/noise";
import { buildProp, buildTorch, disposeProps } from "./props";
import { buildCompound, reservedTiles } from "./compound";
import { Citizens } from "./citizens";
import { Visitors } from "./visitors";
import { alleyClutter, oddity, tenement, wallLantern } from "./warren";

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

/* How much of the city fits on screen, top to bottom, in tiles, at each
   zoom step. The camera is isometric (see ascii3d/iso.js): it hangs off the
   south-east corner and looks down at thirty degrees, as in the survival
   games, and walls in front of you are cut away so you can always see in.
   The front door is the same view pulled back, drifting over the city. */
export const ZOOMS = [9, 12.5, 17, 24];
const INTRO = { distance: 26 };
const MAX_LIGHTS = 10;
const GHOST_LAYER = 1;

/* JR, as a survivor from the Commons. */
const JR = {
    appearance: { skin: "sand", hair: "chestnut", outfit: "tide", cloak: "sea", hairstyle: "cropped", headwear: "none" },
};

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}

function mix(a, b, k) {
    return new THREE.Color(a).lerp(new THREE.Color(b), k);
}

function rgbHex(rgb) {
    return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255).getHexString();
}

export default class SiteScene {
    constructor(container, world, { cellWidth = 4, cellHeight = 7, reducedMotion = false, phase = "dusk" } = {}) {
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
        this.yaw = ISO_YAW;
        this.yawGoal = ISO_YAW;
        this.focus = new THREE.Vector3(world.spawn.x, 0, world.spawn.y);
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
        this.camera = createIsoCamera();

        const p = PHASES[this.phaseName];
        this.hemi = new THREE.HemisphereLight(p.sky, p.ground, p.hemi);
        this.sun = new THREE.DirectionalLight(p.sunColor, p.sun);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        this.sun.shadow.bias = -0.0015;
        const sc = this.sun.shadow.camera;
        sc.left = -36;
        sc.right = 36;
        sc.top = 36;
        sc.bottom = -36;
        sc.near = 1;
        sc.far = 100;
        this.scene.add(this.hemi, this.sun, this.sun.target);
        this.lightPool = [];
        for (let i = 0; i < MAX_LIGHTS; i += 1) {
            const light = new THREE.PointLight(0xffb46b, 0, 8, 2);
            this.scene.add(light);
            this.lightPool.push(light);
        }

        this.water = createWater(110);
        this.water.position.y = WATER_LEVEL;
        this.scene.add(this.water);

        this.reserved = reservedTiles(world.rooms);
        this.measureCity();
        this.findLamps();
        this.buildCompounds();
        this.buildProps();
        this.buildLabels();
        this.citizens = new Citizens(this.scene, world, (x, y) => this.standHeight(x, y));
        /* Everyone else on the site right now, when the server is there. */
        this.visitors = new Visitors(this.scene, this.labelLayer, (x, y) => this.standHeight(x, y));

        this.player = buildSurvivor(JR);
        this.player.scale.setScalar(1.1);
        /* JR is also drawn alone, on a layer of their own, for the outline
           that shows through whatever stands in the way. */
        this.player.traverse((node) => node.layers.enable(GHOST_LAYER));
        this.scene.add(this.player);
        /* Where World.js says JR is this frame: walking is continuous now,
           so this is a position and a heading, not a tile to ease toward. */
        this.walker = { x: world.spawn.x, y: world.spawn.y, facing: Math.PI, speed: 0, running: false, yaw: Math.PI, stride: 0, moving: 0 };
        this.player.position.set(world.spawn.x, this.standHeight(world.spawn.x, world.spawn.y), world.spawn.y);

        this.cursor = buildCursor();
        this.cursor.visible = false;
        this.cursor.scale.setScalar(1.2);
        this.scene.add(this.cursor);

        this.ascii = new AsciiPass();
        /* ?perf=1: frame time, draw calls and triangles in the corner. */
        this.perf = perfEnabled() ? new PerfOverlay(container) : null;
        this.renderer.info.autoReset = !this.perf;

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

    /* Open ground: where people can walk, and so where a building in
       front must not stand taller than the sightline. */
    isOpen(x, y) {
        const kind = this.world.kindAt(x, y);
        return !this.world.isSolid(x, y) || kind === KIND.WALL;
    }

    /*
     * How tall the city stands on every tile. Heights come by the 2x2 lot,
     * so neighbouring tiles rise as one building, over a slow field that
     * swells into districts of taller and lower blocks; the ring at the
     * edge of the world climbs highest, a wall of towers all round.
     */
    measureCity() {
        const { w, h } = this.world;
        this.heights = new Float32Array(w * h);
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                if (!this.isCity(x, y)) continue;
                const lx = x >> 1;
                const ly = y >> 1;
                const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
                const district = fbm(lx * 2, ly * 2, 0.035);
                /* Lower than the old street-level city: seen from above, a
                   block reads by its storeys, and the cut does the rest. */
                let want = 4.2 + district * 7 + hash(lx, ly, 81) * 3 + (hash(x, y, 88) - 0.5) * 1.4;
                if (edge < 7) want += (7 - edge) * 1.8;
                this.heights[y * w + x] = want;
            }
        }
    }

    heightAt(x, y) {
        return this.heights[y * this.world.w + x] || 0;
    }

    /* A lamp every few tiles down each side of every road. */
    findLamps() {
        const world = this.world;
        this.lamps = [];
        this.lampAt = new Map();
        for (let y = 1; y < world.h - 1; y += 1) {
            for (let x = 1; x < world.w - 1; x += 1) {
                if (this.roomOf(x, y) || world.isSolid(x, y)) continue;
                if (world.kindAt(x, y) !== KIND.FLOOR) {
                    /* Down the alleys, a lantern on a bracket now and then. */
                    const wall = [
                        [1, 0],
                        [-1, 0],
                        [0, 1],
                        [0, -1],
                    ].find(([dx, dy]) => this.isCity(x + dx, y + dy));
                    if (!wall || hash(x, y, 12) > 0.16) continue;
                    const spot = { x: x + wall[0] * 0.3, y: y + wall[1] * 0.3, wall, light: { y: 2.5, range: 5, color: 0xffb46b } };
                    this.lamps.push(spot);
                    this.lampAt.set(`${x},${y}`, spot);
                    continue;
                }
                const out = [
                    [0, -1],
                    [0, 1],
                    [-1, 0],
                    [1, 0],
                ].find(([dx, dy]) => world.kindAt(x + dx, y + dy) !== KIND.FLOOR && !this.roomOf(x + dx, y + dy));
                if (!out || (out[0] ? y : x) % 5) continue;
                const spot = { x: x + out[0] * 0.42, y: y + out[1] * 0.42, light: { y: 2.9, range: 7, color: 0xffc77a } };
                this.lamps.push(spot);
                this.lampAt.set(`${x},${y}`, spot);
            }
        }
    }

    buildCompounds() {
        const batch = new Batch();
        this.world.rooms.forEach((room) => {
            buildCompound(batch, room, (x, y) => this.world.kindAt(x, y) !== KIND.WALL, ROOM_FLOOR);
        });
        this.compound = batch.meshes();
        this.compound.forEach((m) => this.scene.add(m));
    }

    /* One lot of the city: the tenement that fills a solid outdoor tile. */
    cityAt(batch, x, y, h) {
        const world = this.world;
        const lx = x >> 1;
        const ly = y >> 1;
        const lot = hash(lx, ly, 81);
        const edge = Math.min(x, y, world.w - 1 - x, world.h - 1 - y);
        const whole = [0, 1].every((dy) => [0, 1].every((dx) => this.isCity(lx * 2 + dx, ly * 2 + dy) && !this.reserved.has(`${lx * 2 + dx},${ly * 2 + dy}`)));

        /* Now and then a lot holds something that does not quite make sense. */
        if (whole && edge > 8 && hash(lx, ly, 89) < 0.05) {
            if (x === lx * 2 && y === ly * 2) oddity(batch, lx * 2 + 0.5, ly * 2 + 0.5, h, hash(lx, ly, 82), 14 + lot * 12);
            return;
        }
        const open = {
            n: this.isOpen(x, y - 1),
            s: this.isOpen(x, y + 1),
            e: this.isOpen(x + 1, y),
            w: this.isOpen(x - 1, y),
        };
        tenement(batch, x, y, h, this.heightAt(x, y), open, Math.floor(lot * 997));
    }

    isCity(x, y) {
        const kind = this.world.kindAt(x, y);
        return (kind === KIND.BLOCK || kind === KIND.TREE || kind === KIND.MOUNTAIN) && !this.roomOf(x, y);
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
                let set = "path";
                let top;
                if (room) {
                    /* Flagstones, kept dark so the floor reads as open
                       ground and what stands on it carries the picture. */
                    const flag = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 0.85 : 1;
                    top = mix("#4b4a42", `#${rgbHex(room.tint)}`, 0.22).multiplyScalar(flag * (0.88 + hash(x, y, 3) * 0.14));
                } else if (kind === KIND.FLOOR) {
                    /* Cobbled avenues. */
                    top = tint("#5d5850", 0.82 + hash(x, y, 4) * 0.22).clone();
                } else {
                    /* Worn setts down the alleys, darker where it is wet. */
                    const wet = hash(x, y, 6) < 0.18 ? 0.7 : 1;
                    top = tint("#8a8274", wet * (0.86 + hash(x, y, 5) * 0.14)).clone();
                }
                batch.quad(set, [x - 0.5, h, y - 0.5], [x - 0.5, h, y + 0.5], [x + 0.5, h, y + 0.5], [x + 0.5, h, y - 0.5], top);

                /* Embankments and kerbs wherever the neighbour sits lower. */
                const bank = tint(room ? "#6d6858" : "#77716a", 0.8).clone();
                [
                    [0, 1, [x - 0.5, y + 0.5], [x + 0.5, y + 0.5]],
                    [0, -1, [x + 0.5, y - 0.5], [x - 0.5, y - 0.5]],
                    [1, 0, [x + 0.5, y + 0.5], [x + 0.5, y - 0.5]],
                    [-1, 0, [x - 0.5, y - 0.5], [x - 0.5, y + 0.5]],
                ].forEach(([dx, dy, a, b]) => {
                    const n = this.groundAt(x + dx, y + dy);
                    const nh = n === null ? SEABED : n;
                    if (nh >= h) return;
                    batch.quad("rock", [a[0], h, a[1]], [a[0], nh, a[1]], [b[0], nh, b[1]], [b[0], h, b[1]], bank);
                });

                if (kind === KIND.WALL && room) {
                    /* The border is the compound's; inside, wall tiles are
                       furniture: cases, counters, the housings of machines. */
                    if (!this.isBorder(room, x, y)) {
                        const wood = mix("#a07850", `#${rgbHex(room.tint)}`, 0.15).multiplyScalar(0.85 + hash(x, y, 7) * 0.15);
                        batch.shape("timber", P.cube(), place(x, h + 0.6, y, 0.98, 1.2, 0.98), wood);
                        batch.shape("timber", P.cube(), place(x, h + 1.24, y, 1.02, 0.08, 1.02), tint("#7a5a3c", 1));
                    }
                } else if (this.isCity(x, y)) {
                    if (!this.reserved.has(`${x},${y}`)) this.cityAt(batch, x, y, h);
                } else if (!room && !world.isSolid(x, y)) {
                    /* An alley: walls either side, and the city strung
                       across the gap overhead. */
                    const lane = (dx, dy) => this.isCity(x - dx, y - dy) && !this.isCity(x + dx, y + dy) && this.isCity(x + 2 * dx, y + 2 * dy);
                    if (this.isCity(x - 1, y) && this.isCity(x + 1, y)) alleyClutter(batch, x, y, h, "x", Math.min(this.heightAt(x - 1, y), this.heightAt(x + 1, y)));
                    else if (this.isCity(x, y - 1) && this.isCity(x, y + 1)) alleyClutter(batch, x, y, h, "z", Math.min(this.heightAt(x, y - 1), this.heightAt(x, y + 1)));
                    else if (lane(1, 0)) alleyClutter(batch, x + 0.5, y, h, "x", Math.min(this.heightAt(x - 1, y), this.heightAt(x + 2, y)), 2);
                    else if (lane(0, 1)) alleyClutter(batch, x, y + 0.5, h, "z", Math.min(this.heightAt(x, y - 1), this.heightAt(x, y + 2)), 2);
                }
                const lamp = this.lampAt.get(`${x},${y}`);
                if (lamp && lamp.wall) wallLantern(batch, lamp.x, lamp.y, h + lamp.light.y, lamp.wall[0], lamp.wall[1]);
                else if (lamp) streetlamp(batch, lamp.x, lamp.y, h, { double: hash(x, y, 9) < 0.3 });
            }
        }
        const group = new THREE.Group();
        batch.meshes().forEach((m) => group.add(m));
        return group;
    }

    updateChunks(all = false) {
        /* Enough to fill the screen, and the tall blocks just below it. */
        const reach = this.distance * 1.3 + 26;
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
            const show = !intro && (label.room ? d > 12 : d < 9);
            const opacity = label.room ? Math.min(1, (d - 12) / 6) : Math.min(1, (9 - d) / 3);
            if (!show || opacity <= 0) {
                if (label.shown) {
                    label.el.style.visibility = "hidden";
                    label.shown = false;
                }
                return;
            }
            tmp.set(label.x, label.room ? 4.2 : label.y, label.z).project(this.camera);
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
        this.visitors.updateLabels((at) => {
            at.project(this.camera);
            if (at.z > 1 || Math.abs(at.x) > 1.05 || Math.abs(at.y) > 1.05) return null;
            return { x: (g.offX + ((at.x + 1) / 2) * w) / g.dpr, y: (g.height - g.offY - ((at.y + 1) / 2) * h) / g.dpr };
        }, !intro);
    }

    /* ── Inputs from React ─────────────────────────────────────────────── */

    setMode(mode) {
        this.mode = mode;
        this.distanceGoal = mode === "intro" ? INTRO.distance : ZOOMS[this.zoom];
    }

    /* Where JR stands and which way they face, every frame. */
    setPose({ x, y, facing, speed = 0, running = false }) {
        const w = this.walker;
        w.x = x;
        w.y = y;
        if (facing !== undefined) w.facing = facing;
        w.speed = speed;
        w.running = running;
    }

    /* Put JR somewhere outright: arriving, or travelling between rooms. */
    setPlayer({ x, y }, { snap = false } = {}) {
        const w = this.walker;
        const far = snap || Math.hypot(w.x - x, w.y - y) > 2.5;
        w.x = x;
        w.y = y;
        if (far) {
            w.speed = 0;
            this.player.position.set(x, this.standHeight(Math.round(x), Math.round(y)), y);
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

    /* Other visitors, from convex/site.ts, as often as they change. */
    setVisitors(list) {
        this.visitors.set(list || []);
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
        this.camera.userData.aspect = (cols * cellW) / (rows * cellH);
    }

    /* ── Per frame ─────────────────────────────────────────────────────── */

    updatePlayer(dt) {
        const w = this.walker;
        const moved = Math.hypot(w.x - this.player.position.x, w.y - this.player.position.z);
        /* Kerbs and thresholds are a hand's height; step up, don't pop. */
        const ground = this.standHeight(Math.round(w.x), Math.round(w.y));
        const h = this.player.position.y + (ground - this.player.position.y) * Math.min(1, dt * 18);
        this.player.position.set(w.x, h, w.y);
        w.moving += ((w.speed > 0.4 ? 1 : 0) - w.moving) * Math.min(1, dt * 12);
        /* A longer, quicker stride when running. */
        w.stride += moved * (w.running ? 3.6 : 4.6);
        /* Turn quickly but not instantly, so changing direction reads as a
           turn rather than a flicker. */
        w.yaw = lerpAngle(w.yaw, w.facing, Math.min(1, dt * 12));
        this.player.rotation.y = w.yaw;
        this.player.visible = this.mode !== "intro";
        pose(this.player, { stride: w.stride, moving: w.moving, t: this.time });
    }

    /* A quarter turn round JR, from the bracket keys. The isometric view
       only ever stands at one of its four corners. */
    rotate(quarters) {
        this.yawGoal += quarters * (Math.PI / 2);
    }

    /* The camera's turn, for turning keys into directions on the map. The
       goal, not where it is mid-swing, so a held key keeps its meaning. */
    heading() {
        return this.yawGoal;
    }

    updateCamera(dt) {
        const intro = this.mode === "intro";
        if (intro) {
            /* The front door drifts slowly across the middle of the city. */
            const t = this.reducedMotion ? 0 : this.time * 0.05;
            tmp.set(this.world.spawn.x + Math.sin(t) * 10, 0, this.world.spawn.y - 6 + Math.cos(t * 0.7) * 6);
            this.focus.lerp(tmp, Math.min(1, dt * 0.8));
        } else {
            /* Stay on JR, leaning a little into where they are heading so
               more of the way ahead is on screen. */
            const w = this.walker;
            const lead = Math.min(1, w.speed / 5) * 1.2;
            tmp.set(this.player.position.x + Math.sin(w.facing) * lead, this.player.position.y, this.player.position.z + Math.cos(w.facing) * lead);
            this.focus.lerp(tmp, Math.min(1, dt * 7));
        }
        this.yaw = lerpAngle(this.yaw, this.yawGoal, Math.min(1, dt * 8));
        this.distance += (this.distanceGoal - this.distance) * Math.min(1, dt * (intro ? 1.5 : 6));
        placeIsoCamera(this.camera, this.focus, this.yaw, this.distance, this.camera.userData.aspect || 1.6);
        /* Whole character cells only, so the city does not crawl as the
           camera follows (see iso.js). */
        snapIsoCamera(this.camera, this.grid.cols, this.grid.rows, this.ascii.uniforms.uCellShift.value);
        /* Open up whatever stands between the camera and JR. */
        aimCutaway(this.camera, this.player.position, { on: !intro, width: 3.2 + this.distance * 0.1, height: 3 + this.distance * 0.08 });
        this.water.position.x = Math.round(this.focus.x);
        this.water.position.z = Math.round(this.focus.z);
    }

    updateLighting() {
        const p = PHASES[this.phaseName];
        const bg = new THREE.Color(p.bg);
        /* The city at night is lit, not dark: a bright moon, a lifted
           ambient and a hotter ASCII pass, so the stone still draws. */
        const night = this.phaseName === "night";
        this.sun.intensity = p.sun + (night ? 0.6 : 0);
        this.ascii.uniforms.uGain.value = { night: 1.4, dusk: 1.25, dawn: 1.2, day: 1.2 }[this.phaseName];
        this.ascii.uniforms.uInk.value = { night: 1.9, dusk: 1.8, dawn: 1.6, day: 1.5 }[this.phaseName];
        /* Each cell's colour also washes its background, so walls and
           towers read as solid masses with type on them, not as type alone. */
        this.ascii.uniforms.uFill.value = night ? 0.62 : 0.55;
        /* Windows and lanterns spill a wash onto the stone around them. */
        this.ascii.uniforms.uGlow.value = { night: 1.3, dusk: 1.0, dawn: 0.6, day: 0.25 }[this.phaseName];
        /* A gentler ramp: close walls fill the view down an alley, and at
           full strength their flat faces drown the edges in letters. */
        this.ascii.uniforms.uRamp.value = 1.55;
        this.ascii.uniforms.uContrast.value = 1.9;
        this.sun.color.set(p.sunColor);
        /* A touch brighter than the Commons: this is a site to read. */
        this.hemi.intensity = p.hemi + { night: 0.5, dusk: 0.5, dawn: 0.45, day: 0.3 }[this.phaseName];
        this.hemi.color.set(p.sky);
        this.hemi.groundColor.set(p.ground);
        this.scene.fog.color.copy(bg);
        /* A haze that starts early and lets the towers fade into it. */
        /* Everything is about as far from an isometric camera, so the haze
           is measured from where it hangs: the top of the screen, further
           off, fades a little into the dark. */
        this.scene.fog.near = ISO_BACK + this.distance * 0.2;
        this.scene.fog.far = ISO_BACK + this.distance * 2.2 + 12;
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
        this.lamps.forEach((lamp) => {
            const d = Math.hypot(lamp.x - this.focus.x, lamp.y - this.focus.z);
            if (d < 30) lit.push({ pos: tmp2.set(lamp.x, ROAD, lamp.y).clone(), light: lamp.light, d: d + 2 });
        });
        lit.sort((x, y) => x.d - y.d);
        const glow = night ? 2 : this.phaseName === "day" ? 0.6 : 1.4;
        this.lightPool.forEach((light, i) => {
            const entry = lit[i];
            if (!entry) {
                light.intensity = 0;
                return;
            }
            const flicker = this.reducedMotion ? 1 : 0.88 + Math.sin(this.time * 13 + i * 3) * 0.07 + Math.sin(this.time * 7.3 + i) * 0.05;
            light.color.setHex(entry.light.color);
            light.distance = entry.light.range * 1.5;
            /* Falling off with the square of distance, so each lamp lights a pool
               and the stone between lamps stays dark. */
            light.intensity = 7 * flicker * glow;
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
        u.uSkyShift.value = (-this.yaw / 1.4) * this.grid.cols;
        u.uSkyTurn.value = ((Math.PI * 2) / 1.4) * this.grid.cols;
        u.uMoon.value = { night: 1, dusk: 0.55, dawn: 0, day: 0 }[this.phaseName];
        u.uHorizon.value.setHex({ night: 0x3a2a48, dusk: 0x5a3238, dawn: 0x4a3a3a, day: 0x4a6890 }[this.phaseName]);
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
        const begin = performance.now();
        if (this.perf) this.renderer.info.reset();
        const dt = Math.min(0.1, this.clock.getDelta());
        this.time += dt;
        this.updatePlayer(dt);
        this.updateCamera(dt);
        this.updateLighting();
        this.updateChunks();
        this.updateProps();
        this.citizens.update(this.reducedMotion ? 0 : dt, this.time, this.focus);
        this.visitors.update(dt, this.time, this.focus);
        this.updateSky();
        wind.uTime.value = this.reducedMotion ? 0 : this.time;
        if (!this.reducedMotion || !this.waterStill) {
            rippleWater(this.water, this.time, this.reducedMotion);
            this.waterStill = this.reducedMotion;
        }
        this.renderer.setRenderTarget(this.ascii.target);
        this.renderer.render(this.scene, this.camera);
        const u = this.ascii.uniforms;
        u.uGhost.value = this.mode === "intro" ? 0 : 1;
        if (u.uGhost.value) this.ascii.renderGhost(this.renderer, this.scene, this.camera, GHOST_LAYER);
        u.uJoints.value = 1;
        u.uOrtho.value = 1;
        u.uInvProj.value.copy(this.camera.projectionMatrixInverse);
        u.uCamToWorld.value.copy(this.camera.matrixWorld);
        this.ascii.render(this.renderer);
        this.updateLabels();
        if (this.perf) this.perf.frame(performance.now() - begin, this.renderer.info, { chunks: this.chunks.size, cells: `${this.grid.cols}x${this.grid.rows}` });
    }

    dispose() {
        cancelAnimationFrame(this.raf);
        CUT.uCutOn.value = 0;
        this.observer.disconnect();
        this.chunks.forEach((group) => {
            this.scene.remove(group);
            group.traverse((node) => {
                if (node.geometry) node.geometry.dispose();
            });
        });
        this.chunks.clear();
        this.compound.forEach((m) => m.geometry.dispose());
        this.citizens.dispose();
        this.visitors.dispose();
        this.props.forEach((prop) => disposeProps(prop.group));
        this.torches.forEach((t) => disposeProps(t.group));
        this.ascii.dispose();
        this.labelLayer.remove();
        if (this.perf) this.perf.dispose();
        disposeMaterials();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

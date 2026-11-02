import * as THREE from "three";
import { CHUNK, WATER } from "../../lib/terrain";
import { AsciiPass, glyphCode } from "./asciiPass";
import { buildChunk, createWater, rippleWater, standHeight, WATER_LEVEL, wind } from "./terrainMesh";
import { GroundMap } from "../../lib/ground";
import { autoFacing } from "../../lib/building";
import { Ghosts } from "./ghost";
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
import { retainMaterials } from "./materials";
import { abandon } from "./abandon";
import { disposeMerged, mergeModel } from "./mergeModel";
import { CUT, ISO_BACK, ISO_YAW, aimCutaway, createIsoCamera, placeIsoCamera, snapIsoCamera } from "./iso";
import { Puffs } from "./puffs";
import { asNews, changedEdits, clearedSet, newlyCleared } from "./worldEvents";
import { PerfOverlay, QualityGovernor, perfEnabled, pinnedQuality, recallQuality, rememberQuality } from "./perf";

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
  *
  * What it deliberately does not do: no game rules, no pathing or collision
  * (navigation.js and prediction.js, driven from the page), no input handling
  * beyond the camera setters below, and no React. Besides picking, it reports
  * what happens in the world through on() / emit() (hits, builds, footsteps,
  * ...), which is how commons/useCommonsSound.js hears it.
  *
  * Who calls it: AsciiField.js is the only place that constructs one (one per
  * mounted field). It forwards its props to setState / setAim / setGhosts /
  * setTurn / setZoom / setRaw / setOrbit / setCellSize, and hands the instance
  * to the page through its `apiRef` for the imperative calls (predictSelf,
  * driveSelf, pick, floatText, rotate, ...). site3d/SiteScene.js and Diorama.js
  * are separate scene classes; they share AsciiPass, iso.js, terrainMesh.js and
  * abandon.js with this one, not this file.
  *
  * Coordinates and units. The server's tile (x, y) is three.js (x, ., z = y):
  * map y is world z, and world y is up. One tile is one world unit. Entities
  * keep their tile-space walk as `from` / `to` ({ x, y } in map coordinates)
  * and their drawn position as `pos`, a Vector3 (x, height, z), so `pos.z`
  * corresponds to the `y` of `from` / `to`. Facing angles are radians in the
  * form atan2(dx, dy) of a map step, used as a rotation about world y.
  * Heights always come from this.ground (a GroundMap, src/lib/ground.js, shared
  * with the server) through terrainMesh.standHeight, so what is drawn is the
  * same ground the server lets you walk on. Times are seconds on this.time,
  * which advances by the clamped frame delta rather than the wall clock.
  *
  * Ownership. init() creates the renderer, its canvas and the fx layer inside
  * `container` and takes a hold on the shared materials (retainMaterials);
  * dispose() gives them back, once. If init() throws, abandon.js undoes
  * whatever got made. Chunk meshes belong to this world (dropChunk frees their
  * geometry); figure geometry and materials are shared and ref-counted, which
  * is what disposeModel / disposeMerged are for.
  *
  * Ordering that matters. setState applies the ground first, so every height
  * read after it is current, and syncs structures before people and creatures
  * because entityHeight() consults this.structures for bridges. Each frame
  * moves the entities before the camera (the camera follows self.pos) and
  * places chunks and the shadow camera after it (both centre on this.focus).
 */

/*
 * How much of the field fits on screen, top to bottom, in tiles, at each
 * zoom step. The camera is isometric (see iso.js), as in the survival games
 * this borrows its feel from: high off one corner, looking down at thirty
 * degrees, turned only a quarter at a time with [ and ]. Whatever stands
 * between it and you, trees and walls and hills, is cut down so you can
 * always see yourself.
 *
 * The index is the step setZoom() takes (1 is the default); the value is
 * `this.distance`, which is placeIsoCamera's `height`.
 */
export const ZOOMS = [8, 11, 15, 21];
/* Limits for zoomBy()'s continuous zoom (pinch and wheel), in the same
   units as ZOOMS but a little wider than its steps. */
const NEAREST = 6;
const FARTHEST = 30;
/* Real point lights for lit fires. The pool is built once and never grown or
   shrunk (changing the light count makes three.js recompile every material);
   spare ones sit at intensity 0. updateEmbers() spreads its sparks over the
   six nearest fires, a figure it keeps separately. */
const MAX_LIGHTS = 6;
/* Main-thread time a frame may spend building chunks once the first view
   is up. Walking brings a chunk or two into reach at a time; spreading them
   out keeps the step that crosses a border from hitching. */
const CHUNK_BUDGET_MS = 4;

/* Sky, sun and fill for each part of the day. Colours are sRGB hex. The
   state's `phase` names an entry. `sun` and `hemi` are light intensities,
   `sunColor` the sun's colour, `sky` and `ground` the hemisphere light's two
   colours, `bg` the fog and background colour, and `angle` (radians) where
   the sun stands in its swing (see updateLighting). */
export const PHASES = {
    dawn: { sun: 1.3, sunColor: "#ffc796", hemi: 0.6, sky: "#a9b0d8", ground: "#3a3a36", bg: "#0d1020", angle: 0.5 },
    day: { sun: 1.7, sunColor: "#f6efe0", hemi: 0.8, sky: "#b9cdf0", ground: "#34443a", bg: "#0c1322", angle: 1.0 },
    dusk: { sun: 1.0, sunColor: "#ff9d6a", hemi: 0.5, sky: "#a68cb0", ground: "#3a3030", bg: "#110d1c", angle: 0.4 },
    night: { sun: 0.4, sunColor: "#8fa7ff", hemi: 0.26, sky: "#4f5c95", ground: "#1a1e2a", bg: "#070a16", angle: 0.8 },
};
/* A multiplier on a phase's `sun` and `hemi` for each kind of weather (the
   state's `weather`). */
const WEATHER_DIM = { clear: 1, rain: 0.72, storm: 0.55, fog: 0.82 };

/* Scratch objects, reused so a frame allocates nothing. They are shared by
   every method here, so none may be held across a call to another; `tmp` in
   particular is borrowed by pick(), the label, bar and floater projections,
   updateCamera and updateLighting. */
const tmp = new THREE.Vector3();
const ndc = new THREE.Vector2();
const m4 = new THREE.Matrix4();
const goalColor = new THREE.Color();
const lightRight = new THREE.Vector3();
const lightUp = new THREE.Vector3();
const lightDir = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const pickRay = new THREE.Raycaster();
/* A horizontal plane; pick() slides its `constant` to the height of the
   ground it is testing. */
const pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/*
 * Only a figure's larger parts throw a shadow. A button or an eye casts one a
 * cell or two across at most, which the ASCII pass cannot draw, yet each is
 * another draw call in the shadow pass for every person on screen.
 */
const SHADOW_PART = 0.09;
const partScale = new THREE.Vector3();
/* Run it before mergeModel(), which would otherwise judge each merged mesh as
   one big part. SHADOW_PART is in world units: a part's bounding radius times
   its largest world scale. */
function trimShadows(model) {
    model.updateMatrixWorld(true);
    model.traverse((node) => {
        if (!node.isMesh || !node.castShadow) return;
        const g = node.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        node.getWorldScale(partScale);
        const size = g.boundingSphere.radius * Math.max(partScale.x, partScale.y, partScale.z);
        if (size < SHADOW_PART) node.castShadow = false;
    });
    return model;
}

/* Interpolate from angle `a` to `b` (radians) the short way round, `t` 0..1. */
function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
}


/*
 * One instance per mounted field. Construction is split into the constructor
 * and init() only so the constructor can catch a failure part-way through (no
 * WebGL, say) and have abandon.js clean up the half-built object.
 *
 * `container` is the element the canvas goes in. Options: `cellWidth` and
 * `cellHeight`, one character cell in CSS pixels (see AsciiField.DENSITIES),
 * and `reducedMotion`, which stills the sea, embers, rain splashes, lightning,
 * camera shake, the build ghost's breath and the rise of new structures.
 */
export default class AsciiWorld {
    constructor(container, options) {
        /* If setting up throws, the caller never gets this to dispose of,
           so it disposes of itself before passing the error on. */
        try {
            this.init(container, options);
        } catch (error) {
            abandon(this);
            throw error;
        }
    }

    init(container, { cellWidth = 8, cellHeight = 14, reducedMotion = false } = {}) {
        this.container = container;
        this.reducedMotion = reducedMotion;
        this.cellCss = { w: cellWidth, h: cellHeight };
        this.state = null;
        this.aim = null;
        this.aimOk = true;
        /* `turn` is the camera's quarter turn, 0..3, as React sets it (setTurn).
           `yawGoal` is the angle the camera is heading for and `yaw` where its easing
           has got to; `distance` eases toward `distanceGoal` the same way. */
        this.turn = 0;
        this.yaw = ISO_YAW;
        this.zoom = 1;
        this.distance = ZOOMS[1];
        this.distanceGoal = ZOOMS[1];
        this.yawGoal = ISO_YAW;
        /* Seconds of camera shake left; a blow to yourself sets it. */
        this.shake = 0;
        /* Once the game steers you itself, the server's word on where you
           stand only reaches the screen through it (see predictSelf). */
        this.selfDriven = false;
        this.self = null;
        /* Rising DOM text (see floatText), and the element for each player
           name tag React registers (registerLabel). */
        this.floaters = [];
        this.orbit = false;
        this.labels = new Map();
        this.players = new Map();
        this.creatures = [];
        this.leaving = [];
        this.structures = new Map();
        /* Terrain meshes by "cx:cy" chunk key, and structures by "x,y". The two
           are separate so building or demolishing never rebuilds terrain. */
        this.chunks = new Map();
        /* Chunks waiting to be built, nearest first, and what the last look
           round for them saw (see updateChunks). */
        this.chunkQueue = [];
        this.chunkScan = null;
        this.chunksDirty = true;
        /* Per chunk, the signature of its harvested tiles. */
        this.clearedByChunk = new Map();
        /* Rebuilt by refreshFires() when structures change: `fires` are the
           positions embers rise from, `lit` the structures that hold a light. */
        this.fires = [];
        this.lit = [];
        /* Camera snapping to whole character cells (see snapIsoCamera):
           `cellShift` is the camera's position in cells, wrapped, for the pass's
           ground-keyed texture; `slack` is the fraction of a cell the snap moved it,
           which becomes shiftX / shiftY. */
        this.cellShift = new THREE.Vector2();
        /* The picture's slide under the characters, in device pixels. */
        this.shiftX = 0;
        this.shiftY = 0;
        this.slack = new THREE.Vector2();
        /* The top step of perf.js's QUALITY; the governor replaces it. */
        this.quality = { shadow: 1024, cell: 1, dpr: 3, ascii: "full" };
        /* Dug and piled ground, as last heard from the server. */
        this.ground = new GroundMap();
        this.flames = [];
        /* What the camera looks at, in world space. It eases toward the player
           (or the middle of the view before there is one); `focusReady` makes the
           first target a jump instead of a swoop. */
        this.focus = new THREE.Vector3();
        this.focusReady = false;
        this.selfFacing = null;
        this.clock = new THREE.Clock();
        this.time = 0;
        /* Lightning: `flash` falls from 1 to 0 after a strike, `nextFlash` counts
           down the seconds to the next (see updateLighting). */
        this.flash = 0;
        this.nextFlash = 4;

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
        /* Past the point a missing WebGL throws: from here dispose() runs. */
        this.materials = retainMaterials();
        /* Device pixels are handled by hand: resize() works in them (grid.dpr)
           and calls setSize(w, h, false), so the renderer's own ratio stays 1. */
        this.renderer.setPixelRatio(1);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.autoClear = true;
        /* Counted over the whole frame (scene, shadows, both passes), not
           just the last render call. */
        this.renderer.info.autoReset = false;
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
        /* Placeholder: updateLighting sets colour, near and far every frame. */
        this.scene.fog = new THREE.Fog(0x0b120d, 20, 40);
        this.camera = createIsoCamera();
        this.isoCamera = this.camera;
        /* Seen from behind your own eyes: a perspective camera, looking
           where yawGoal and pitch say.
           72 is the vertical field of view in degrees; the aspect is a
           placeholder that resize() replaces. */
        this.fpCamera = new THREE.PerspectiveCamera(72, 1.6, 0.1, 140);
        this.firstPerson = false;
        this.pitch = 0;

        this.hemi = new THREE.HemisphereLight(0xd3e6ff, 0x4a5a3a, 1);
        this.scene.add(this.hemi);
        this.sun = new THREE.DirectionalLight(0xffffff, 2);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(1024, 1024);
        /* The shadow box (+-28) and map size are only starting values:
           updateLighting resizes the box with the zoom and applyQuality changes the
           map size. */
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
            /* Colour, range and intensity are reassigned each frame for
               whichever fires are nearest (updateLighting). */
            const light = new THREE.PointLight(0xffb46b, 0, 8, 1.2);
            this.scene.add(light);
            this.lightPool.push(light);
        }
        /* The working copy of PHASES that updateLighting eases toward the current
           phase's entry, so dawn and dusk take a few seconds. Its colours are
           THREE.Colors so they can be lerped in place. */
        this.phase = { ...PHASES.day, sunColor: new THREE.Color(PHASES.day.sunColor), sky: new THREE.Color(PHASES.day.sky), ground: new THREE.Color(PHASES.day.ground), bg: new THREE.Color(PHASES.day.bg) };

        /* One sea plane, 72 tiles across, re-centred on the view every frame
           (see updateCamera), not one per chunk. */
        this.water = createWater(72);
        this.water.position.y = WATER_LEVEL;
        this.scene.add(this.water);

        this.cursor = buildCursor();
        this.cursor.visible = false;
        this.scene.add(this.cursor);
        this.ghosts = new Ghosts(this.scene);

        this.splashes = this.createSplashes();
        this.scene.add(this.splashes);
        this.embers = this.createEmbers();
        this.sparks = this.createSparks();
        this.scene.add(this.sparks);
        this.scene.add(this.embers);
        this.puffs = new Puffs(this.scene, { still: reducedMotion });
        /* Who hears about what happens here: blows, felled trees, digging,
           footsteps (see on() and commons/sound.js). */
        this.listeners = new Set();
        this.cleared = null;

        /* The ASCII pass reads the offscreen render and draws characters. The
           scene is rendered into this.ascii.target, never straight to the
           canvas (see frame). */
        this.ascii = new AsciiPass();

        /* ?perf=1 shows the numbers; the governor trades quality for speed
           on machines that cannot keep up (see perf.js). */
        this.perf = perfEnabled() ? new PerfOverlay(container) : null;
        const pinned = pinnedQuality();
        /* Only steps the governor measured its way to are remembered:
           saving the step it was started on would walk it down one more
           every visit (see recallQuality). */
        let measured = false;
        this.governor = new QualityGovernor({
            enabled: pinned === null,
            onChange: (quality, level) => {
                this.applyQuality(quality);
                if (pinned === null && measured) rememberQuality(level);
            },
        });
        const start = pinned ?? recallQuality();
        if (start) this.governor.set(start);
        measured = true;
        /* For poking at from the console while tuning. */
        if (this.perf) window.asciiWorld = this;

        this.resize = this.resize.bind(this);
        this.frame = this.frame.bind(this);
        this.observer = new ResizeObserver(this.resize);
        this.observer.observe(container);
        this.watchPixelRatio();
        this.resize();
        this.raf = requestAnimationFrame(this.frame);
    }

    /* ── Size and the character grid ───────────────────────────────────── */

    /*
     * Sizes everything in device pixels: the canvas is the CSS box times dpr
     * (capped by the quality step's dpr), a character cell is the CSS cell size
     * times the step's `cell` times dpr (never under 3 x 5), and the grid is the
     * whole cells that fit (at least 8 x 6), centred by offX / offY. The camera's
     * aspect comes from the grid, not the box, so the leftover margin never
     * stretches the picture. Called by the ResizeObserver, by watchPixelRatio,
     * and when quality or the cell size change.
     */
    resize() {
        const box = this.container.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, this.quality.dpr ?? 2);
        const width = Math.max(1, Math.floor(box.width * dpr));
        const height = Math.max(1, Math.floor(box.height * dpr));
        const scale = this.quality.cell;
        const cellW = Math.max(3, Math.round(this.cellCss.w * scale * dpr));
        const cellH = Math.max(5, Math.round(this.cellCss.h * scale * dpr));
        const cols = Math.max(8, Math.floor(width / cellW));
        const rows = Math.max(6, Math.floor(height / cellH));
        const before = this.grid;
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

        /* A box that changed by less than a cell (a phone's address bar
           sliding away, say) keeps the same grid: only the margins move, so
           the pass keeps its targets rather than making them all again. */
        if (before && before.cols === cols && before.rows === rows && before.cellW === cellW && before.cellH === cellH) {
            this.ascii.offset = { x: this.grid.offX, y: this.grid.offY };
            this.ascii.setShift(this.shiftX, this.shiftY);
            return;
        }
        this.ascii.setSize(this.grid);
        this.camera.userData.aspect = (cols * cellW) / (rows * cellH);
        this.isoCamera.userData.aspect = this.camera.userData.aspect;
        this.fpCamera.aspect = this.camera.userData.aspect;
        this.fpCamera.updateProjectionMatrix();
    }

    /* Dragging the window to another screen, or zooming the page, changes
       the pixel ratio without changing the box, so ResizeObserver never
       hears of it and the characters come out blurred or the wrong size. */
    watchPixelRatio() {
        this.unwatchPixelRatio?.();
        if (typeof window.matchMedia !== "function") return;
        const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
        const changed = () => {
            this.resize();
            this.watchPixelRatio();
        };
        query.addEventListener?.("change", changed, { once: true });
        this.unwatchPixelRatio = () => query.removeEventListener?.("change", changed);
    }

    /* A step of the governor: shadow detail, then cell size. */
    applyQuality(quality) {
        const resize = quality.cell !== this.quality.cell || quality.dpr !== this.quality.dpr;
        this.ascii.setTier(quality.ascii);
        this.quality = quality;
        const shadows = quality.shadow > 0;
        /* three.js sees the change in lights and recompiles what it must. */
        this.sun.castShadow = shadows;
        if (shadows && this.sun.shadow.mapSize.x !== quality.shadow) {
            this.sun.shadow.mapSize.set(quality.shadow, quality.shadow);
            if (this.sun.shadow.map) {
                this.sun.shadow.map.dispose();
                this.sun.shadow.map = null;
            }
        }
        if (resize) this.resize();
    }

    /* A character cell's size in CSS pixels (the density toggle). */
    setCellSize(w, h) {
        this.cellCss = { w, h };
        this.resize();
    }

    /* How many character columns the picture is across, now. */
    get columns() {
        return this.grid.cols;
    }

    /* ── Inputs from React ─────────────────────────────────────────────── */

    /*
     * Take a server snapshot: { cells, players, monsters, ground, groundChunks,
     * view, phase, weather, now, ... }. Call it with each new one; null is
     * remembered but leaves the models as they were. The ground goes in first
     * (its previous byChunk is copied beforehand, since absorb() updates the
     * entries it holds) so heights are right for the syncs that follow, and
     * noticeWork() then diffs this snapshot against the last for news.
     */
    setState(state) {
        this.state = state;
        const groundBefore = new Map(this.ground.byChunk);
        const groundChanged = this.ground.absorb(state);
        this.chunksDirty = true;
        if (!state) return;
        this.noticeWork(state, groundBefore, groundChanged);
        this.indexCleared(state);
        this.syncStructures(state);
        this.syncPlayers(state);
        this.syncCreatures(state);
        this.setPhase(state.phase, state.weather);
    }

    /* Listen for what happens in the world. Returns how to stop.
       (`listener(type, detail)`; the types are the ones emit() is called with
       below and in the frame loop: harvest, dig, build, demolish, hit, slain,
       swing, step, gain, level, thunder; most carry world x / z in `detail`.) */
    on(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit(type, detail = {}) {
        this.listeners.forEach((listener) => {
            try {
                listener(type, detail);
            } catch {
                /* A listener's trouble is its own. */
            }
        });
    }

    /* What the place sounds like from where the view is: the time of day,
       the weather, how near the nearest fire is, and how much water is
       about. Cheap enough to ask a few times a second.
       `fire` is the distance in tiles to the nearest lit fire, Infinity if none;
       `water` the fraction of a 7 x 7 spread of tiles (two apart) around the
       view that is water. */
    ambience() {
        const cx = Math.round(this.focus.x);
        const cz = Math.round(this.focus.z);
        let water = 0;
        let seen = 0;
        for (let dz = -6; dz <= 6; dz += 2) {
            for (let dx = -6; dx <= 6; dx += 2) {
                seen += 1;
                if (this.ground.tile(cx + dx, cz + dz) === WATER) water += 1;
            }
        }
        return {
            phase: this.phaseName || "day",
            weather: this.weather || "clear",
            fire: this.nearestFire ?? Infinity,
            water: water / seen,
            orbit: this.orbit,
        };
    }

    /* How far a point is from the middle of the view, in tiles. */
    distanceTo(x, z) {
        return Math.hypot(x - this.focus.x, z - this.focus.z);
    }

    /* Trees felled, rocks broken and ground dug since the last snapshot:
       a puff for each nearby, and word of it to listeners.
       The first snapshot has no `before`, so reports nothing. Only changes
       within 12 tiles of the view count, and asNews drops a crowd of them at once
       as loading rather than events. */
    noticeWork(state, groundBefore, groundChanged) {
        const before = this.cleared;
        this.cleared = clearedSet(state.cells);
        if (!before) return;
        const near = (t) => this.distanceTo(t.x, t.y) < 12;
        asNews(newlyCleared(before, state.cells).filter(near)).forEach((t) => {
            const at = { x: t.x, y: this.ground.height(t.x, t.y), z: t.y };
            this.puffs.add(t.kind === "stump" ? "wood" : "stone", at, this.time);
            if (t.kind === "stump") this.puffs.add("leaf", { ...at, y: at.y + 1.2 }, this.time);
            this.emit("harvest", { x: t.x, z: t.y, kind: t.kind });
        });
        asNews(changedEdits(groundBefore, this.ground.byChunk, groundChanged).filter(near)).forEach((t) => {
            const at = { x: t.x, y: Math.max(WATER_LEVEL, this.ground.height(t.x, t.y)), z: t.y };
            this.puffs.add("earth", at, this.time);
            this.emit("dig", { x: t.x, z: t.y });
        });
    }

    /* The tile the cursor rings, { x, y } in map coordinates or null; `ok`
       tints it as a valid or invalid target. */
    setAim(aim, ok = true) {
        this.aim = aim;
        this.aimOk = ok;
    }

    /* The build ghosts (see ghost.js), seated like real structures.
       The `deck` height here (WATER_LEVEL + 0.12) is the one syncStructures
       uses for things built over water; keep the two in step by hand. */
    setGhosts(list) {
        this.ghosts.set(list, (x, y) => ({
            height: this.ground.height(x, y),
            overWater: this.ground.tile(x, y) === WATER,
            deck: WATER_LEVEL + 0.12,
        }));
    }

    /* Snap to a quarter turn, the nearest way round.
       `yaw` is left alone; updateCamera eases it toward the new `yawGoal`. */
    setTurn(turn) {
        this.turn = ((turn % 4) + 4) % 4;
        const goal = ISO_YAW + (this.turn * Math.PI) / 2;
        let d = goal - this.yawGoal;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yawGoal += d;
    }

    /* `zoom` indexes ZOOMS and is clamped to it. */
    setZoom(zoom) {
        this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, zoom));
        this.distanceGoal = ZOOMS[this.zoom];
    }

    /* A quarter turn, one way or the other. The isometric view only ever
       stands at one of its four corners. */
    rotate(dyaw) {
        if (dyaw) this.yawGoal += Math.sign(dyaw) * (Math.PI / 2);
    }

    /* Multiplies the zoom distance by `factor` between NEAREST and FARTHEST,
       whatever step setZoom last chose. */
    zoomBy(factor) {
        this.distanceGoal = Math.max(NEAREST, Math.min(FARTHEST, this.distanceGoal * factor));
    }

    /* Step into your own eyes, or back out to the isometric view. */
    setFirstPerson(on) {
        if (on === this.firstPerson) return;
        this.firstPerson = on;
        this.camera = on ? this.fpCamera : this.isoCamera;
        this.pitch = 0;
        if (!on) {
            /* Back to the nearest of the four isometric corners. */
            const q = Math.round((this.yawGoal - ISO_YAW) / (Math.PI / 2));
            this.yawGoal = ISO_YAW + q * (Math.PI / 2);
            this.shiftX = 0;
            this.shiftY = 0;
            this.ascii.setShift(0, 0);
            if (this.self) this.self.model.visible = true;
        }
    }

    /* Turn your head: `dx` to the right and `dy` down, in radians.
       (Pitch is held to +-1.1 radians, about 63 degrees.) */
    look(dx, dy) {
        if (!this.firstPerson) return;
        this.yawGoal -= dx;
        this.pitch = Math.max(-1.1, Math.min(1.1, this.pitch - dy));
    }

    /* The world tile at the middle of the view, for aiming. */
    pickCenter() {
        const rect = this.renderer.domElement.getBoundingClientRect();
        return this.pick(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    /* The camera's turn, for turning keys into directions on the map
       (see iso.js). The goal, not the swing, so a held key keeps its way. */
    heading() {
        return this.yawGoal;
    }

    /* Move yourself at once, before the server confirms, so walking feels
       like walking. The game squares this with the server step by step
       (see prediction.js) and calls it again with any correction.
       `x`, `y` are the tile in map coordinates; `duration` the seconds the
       walk takes. */
    predictSelf(x, y, duration = 0.15) {
        const self = this.selfEntity();
        if (!self) return;
        this.selfDriven = true;
        this.moveEntity(self, x, y, duration);
    }

    /* Put yourself wherever the body is, every frame: the same continuous
       walking as the site (see world/motion.js). The server only ever hears
       which tile you are on; what is drawn is the body itself. `snap` jumps
       there instead of walking.
       `x`, `y` are fractional map coordinates; `speed` is the body's own, and
       above 0.3 the figure turns to `facing` (radians) and counts as walking.
       Once called, the figure follows the body (followBody) and stops easing
       between the server's tiles. */
    driveSelf({ x, y, speed, facing }, snap = false) {
        const self = this.selfEntity();
        if (!self) return;
        this.selfDriven = true;
        self.driven = { x, y, speed, facing };
        self.from = { x, y };
        self.to = { x, y };
        if (snap) {
            self.pos.set(x, this.entityHeight(Math.round(x), Math.round(y)), y);
            this.focus.set(x, self.pos.y, y);
        }
    }

    selfEntity() {
        return this.self;
    }

    /* Words that rise off someone and fade: damage, gains, a level.
       `x`, `y` are map coordinates; `kind` picks the CSS modifier
       ascii3d__float--<kind>; `lift` is world units above the ground. Removed by
       updateFloaters after 1.1 s. */
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
        if (!self) return;
        this.floatText(self.pos.x, self.pos.z, text, kind, 2.3);
        this.emit(kind === "level" ? "level" : "gain", { text });
    }

    /* Show the plain render instead of the characters (a debugging view). */
    setRaw(raw) {
        this.ascii.uniforms.uRaw.value = raw ? 1 : 0;
    }

    setOrbit(orbit) {
        this.orbit = orbit;
    }

    /* Turn yourself to face what you are working on.
       (`dx`, `dy` is a map step; the turn is applied on the next updateCamera.) */
    faceSelf(dx, dy) {
        this.selfFacing = Math.atan2(dx, dy);
    }

    /* Swing the arm: chopping, mining, hitting. Purely for show. */
    swingSelf() {
        const self = this.selfEntity();
        if (!self) return;
        self.attackStart = this.time;
        this.emit("swing", { x: self.pos.x, z: self.pos.z });
    }

    registerLabel(id, element) {
        if (element) this.labels.set(id, element);
        else this.labels.delete(id);
    }

    /* The world tile under a point on screen, or null.
       Takes page (client) pixels. Returns { x, y } in map coordinates, or null
       when the point is outside the character grid or the ray misses the ground. */
    pick(clientX, clientY) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const g = this.grid;
        const px = (clientX - rect.left) * g.dpr - g.offX - this.shiftX;
        const py = g.height - (clientY - rect.top) * g.dpr - g.offY - this.shiftY;
        const w = g.cols * g.cellW;
        const h = g.rows * g.cellH;
        if (px < 0 || py < 0 || px > w || py > h) return null;
        ndc.set((px / w) * 2 - 1, (py / h) * 2 - 1);
        /* Called on every pointer move and, in first person, every frame. */
        const ray = pickRay;
        ray.setFromCamera(ndc, this.camera);
        let height = this.focus.y;
        let tile = null;
        /* The ground is terraced, so settle on the height of the tile hit. */
        for (let i = 0; i < 3; i += 1) {
            pickPlane.constant = -height;
            const hit = ray.ray.intersectPlane(pickPlane, tmp);
            if (!hit) return tile;
            tile = { x: Math.round(hit.x), y: Math.round(hit.z) };
            const next = Math.max(WATER_LEVEL, this.ground.height(tile.x, tile.y));
            if (Math.abs(next - height) < 0.01) break;
            height = next;
        }
        return tile;
    }

    /* ── Server snapshot → models ──────────────────────────────────────── */

    /* Whether a built floor stands on the tile; over water it is a walkable
       bridge, which entityHeight() stands people on instead of the sea. */
    bridged(x, y) {
        const s = this.structures.get(`${x},${y}`);
        return Boolean(s && s.kind === "floor");
    }

    /* World height a person or creature stands at on tile (x, y). */
    entityHeight(x, y) {
        return standHeight(x, y, this.bridged(x, y), this.ground.editAt(x, y));
    }

    /* Harvested tiles, gathered by chunk once per snapshot rather than once
       per frame. */
    indexCleared(state) {
        const byChunk = new Map();
        state.cells.forEach((c) => {
            if (c.kind !== "stump" && c.kind !== "rubble") return;
            const key = `${Math.floor(c.x / CHUNK)}:${Math.floor(c.y / CHUNK)}`;
            if (!byChunk.has(key)) byChunk.set(key, []);
            byChunk.get(key).push(`${c.x},${c.y}`);
        });
        this.clearedByChunk = new Map();
        byChunk.forEach((list, key) => {
            /* Sorted so the same tiles always make the same signature; scanChunks
               compares signatures to tell whether a chunk needs rebuilding. */
            list.sort();
            this.clearedByChunk.set(key, { list, signature: list.join(";") });
        });
    }

    /*
     * Reconcile this.structures (keyed "x,y") with state.cells. A cell whose
     * structureKey (kind, lit, over water) is unchanged is kept and only turned
     * or opened; any other change rebuilds it. Stumps and rubble are cells too,
     * so a tree growing back is one disappearing.
     */
    syncStructures(state) {
        const seen = new Set();
        const walls = new Set(state.cells.filter((c) => c.kind === "wall").map((c) => `${c.x},${c.y}`));
        const wallAt = (x, y) => walls.has(`${x},${y}`);
        /* Anything new after the first snapshot rises out of the ground, so
           somebody else's wall going up reads as building, not a pop. */
        const grow = this.structuresSeen;
        this.structuresSeen = true;
        state.cells.forEach((cell) => {
            const key = `${cell.x},${cell.y}`;
            seen.add(key);
            const overWater = this.ground.tile(cell.x, cell.y) === WATER;
            const ctx = {
                /* Only a campfire burns out; `fuelUntil` and `now` are the server's clock. */
                lit: cell.kind === "campfire" ? cell.fuelUntil > state.now : true,
                overWater,
                /* Height of the deck that things built over water sit on. */
                deck: WATER_LEVEL + 0.12,
            };
            const k = structureKey(cell, ctx);
            /* Turned by hand, or a door or sign set across its wall. */
            const facing = cell.facing ?? (cell.kind === "door" || cell.kind === "sign" ? autoFacing(cell.x, cell.y, wallAt) : 0);
            const existing = this.structures.get(key);
            if (existing && existing.key === k) {
                if (existing.group.userData.hinge) existing.group.userData.open = cell.open ? 1 : 0;
                existing.group.rotation.y = (facing * Math.PI) / 2;
                return;
            }
            if (existing) this.removeStructure(key);
            const group = buildStructure(cell, ctx);
            if (!group) return;
            /* Over water the group stays at 0 and the model lifts its own parts by
               ctx.deck (see models.js); on land it stands on the terrain. */
            group.position.set(cell.x, overWater ? 0 : this.ground.height(cell.x, cell.y), cell.y);
            group.rotation.y = (facing * Math.PI) / 2;
            /* Judged at full height, before it starts to rise. */
            mergeModel(trimShadows(group));
            if (grow && !existing && !this.reducedMotion) {
                group.userData.born = this.time;
                group.scale.set(1, 0.05, 1);
            }
            /* Only what goes up within 14 tiles of the view is heard and kicks up dust. */
            if (grow && !existing && this.distanceTo(cell.x, cell.y) < 14) {
                this.puffs.add("dust", { x: cell.x, y: group.position.y, z: cell.y }, this.time);
                this.emit("build", { x: cell.x, z: cell.y, kind: cell.kind, mine: Boolean(cell.mine) });
            }
            group.traverse((node) => {
                if (node.userData.flame) this.flames.push(node);
            });
            this.scene.add(group);
            this.structures.set(key, { group, key: k, kind: cell.kind });
            this.firesDirty = true;
        });
        [...this.structures.keys()].forEach((key) => {
            if (seen.has(key)) return;
            const s = this.structures.get(key);
            const { x, z } = s.group.position;
            /* A stump or rubble going is regrowth, not demolition. */
            if (s.kind !== "stump" && s.kind !== "rubble" && this.distanceTo(x, z) < 14) {
                this.puffs.add("dust", { x, y: s.group.position.y, z }, this.time);
                this.puffs.add(s.kind === "wall" || s.kind === "furnace" ? "stone" : "wood", { x, y: s.group.position.y + 0.6, z }, this.time);
                this.emit("demolish", { x, z, kind: s.kind });
            }
            this.removeStructure(key);
        });
    }

    /* Both frees are needed: disposeModel releases the model's own materials
       (the flames') and figure geometry, disposeMerged the geometry mergeModel
       made. Each is safe after the other (releaseFigure does nothing twice). */
    removeStructure(key) {
        const s = this.structures.get(key);
        if (!s) return;
        s.group.traverse((node) => {
            if (node.userData.flame) this.flames = this.flames.filter((f) => f !== node);
        });
        disposeModel(s.group);
        disposeMerged(s.group);
        this.scene.remove(s.group);
        this.structures.delete(key);
        this.firesDirty = true;
    }

    /*
     * Start `entity` walking to tile (x, y) over `duration` seconds. A jump of
     * more than 2.5 tiles is a teleport, not a walk: it starts at the new tile and
     * keeps its facing. Otherwise the walk starts from wherever the body is now
     * (possibly mid-stride) and turns to face the step.
     */
    moveEntity(entity, x, y, duration) {
        if (entity.to.x === x && entity.to.y === y) return;
        const far = Math.hypot(entity.to.x - x, entity.to.y - y) > 2.5;
        const dx = x - entity.to.x;
        const dy = y - entity.to.y;
        entity.from = far ? { x, y } : { x: entity.pos.x, y: entity.pos.z };
        /* A step taken mid-stride starts between tiles, where the ground
           overlay has nothing to say; start it from the height the body is
           at instead of looking one up. */
        entity.fromH = far ? null : entity.pos.y;
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

    /*
     * Wrap a freshly built model in the per-frame state updateEntity and
     * finishEntity animate. The model is added to the scene here; whoever drops
     * the entity must scene.remove it and disposeMerged it. `pos` is the model's
     * own position vector, so moving it moves the model. `lastStep` and
     * `attackStart` begin far in the past so nothing looks recent; `baseScale` is
     * the authored size that the pop-in and shrink-away multiply.
     */
    makeEntity(model, x, y) {
        mergeModel(trimShadows(model));
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

    /*
     * Reconcile this.players (by id) with state.players. A change of lookKey
     * (clothes, tools) rebuilds the model in place. Once the game drives you
     * (selfDriven) your own entity is not moved from here. The snapshot carries no
     * events, so a drop in hp is how a blow is noticed. Anyone missing from the
     * snapshot leaves().
     */
    syncPlayers(state) {
        const seen = new Set();
        let self = null;
        state.players.forEach((p) => {
            seen.add(p.id);
            const key = lookKey(p);
            let entity = this.players.get(p.id);
            if (entity && entity.key !== key) {
                this.scene.remove(entity.model);
                disposeMerged(entity.model);
                const model = mergeModel(trimShadows(buildSurvivor(p)));
                model.position.copy(entity.pos);
                this.scene.add(model);
                entity.model = model;
                entity.pos = model.position;
                entity.key = key;
            }
            if (!entity) {
                entity = this.makeEntity(buildSurvivor(p), p.x, p.y);
                /* People ease through the server's whole-tile steps (see updateEntity). */
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
            if (p.self) {
                self = entity;
                if (this.selfDriven) return;
            }
            this.moveEntity(entity, p.x, p.y, 0.15);
        });
        [...this.players.keys()].forEach((id) => {
            if (seen.has(id)) return;
            this.leave(this.players.get(id));
            this.players.delete(id);
        });
        this.self = self;
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
            let best = m.id ? pool.findIndex((c) => c && c.data?.id === m.id) : -1;
            /* The match radius in tiles for a creature with no id; -1 shuts the
               fallback out once an id has matched. */
            let bestDistance = best >= 0 ? -1 : 2.5;
            pool.forEach((c, i) => {
                /* Without ids, the nearest of its kind is probably it. */
                if (!c || c.kind !== m.kind || (m.id && c.data?.id)) return;
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
            /* A creature's step is spread over 0.4 s, a person's over 0.15 s. */
            this.moveEntity(entity, m.x, m.y, 0.4);
            next.push(entity);
        });
        pool.forEach((c) => {
            if (c) this.leave(c);
        });
        this.creatures = next;
    }

    /* A blow lands on `entity`: sparks, a white flash for 0.09 s, floating
       `-amount` text and a "hit" event. `kind` "hurt" marks damage to yourself. */
    hit(entity, amount = 0, kind = "damage") {
        this.emit("hit", { x: entity.pos.x, z: entity.pos.z, amount, self: entity === this.self || kind === "hurt", creature: entity.kind || null });
        entity.hurt = 1;
        entity.hurtAt = this.time;
        entity.flashUntil = this.time + 0.09;
        this.burst(entity.pos, entity.baseScale);
        if (amount > 0) this.floatText(entity.pos.x, entity.pos.z, `-${amount}`, kind, 1.4 * entity.baseScale + 0.5);
    }

    /* A spray of sparks where a blow lands. */
    burst(at, size = 1) {
        this.lastBurst = this.time;
        /* A ring buffer of 48 (see createSparks): the oldest is overwritten. */
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

    /* These small instanced meshes carry their glyph set in the material's
       opacity (glyphCode): with NoBlending it reaches the target as written, and
       the ASCII pass reads it as the character set to draw. 4 is the fire set. */
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
        /* Nothing struck for a while: nothing to move. */
        if (!mesh.visible && this.time - (this.lastBurst ?? -10) > 0.4) return;
        const m = m4;
        let any = false;
        mesh.userData.seeds.forEach((s, i) => {
            const t = s ? this.time - s.born : 1;
            if (!s || t > 0.35) {
                m.makeScale(0, 0, 0);
            } else {
                any = true;
                const size = 1 - t / 0.35;
                /* Shrinks to nothing over 0.35 s, flying on a parabola (gravity 12). */
                m.makeScale(size, size, size).setPosition(s.x + s.vx * t, s.y + s.vy * t - 6 * t * t, s.z + s.vz * t);
            }
            mesh.setMatrixAt(i, m);
        });
        mesh.visible = any;
        mesh.instanceMatrix.needsUpdate = true;
    }

    /* Creatures' health, as a little bar of characters over the hurt.
       Screen position, here and in updateFloaters and updateLabels: projected
       (normalised device) coordinates are mapped into the character grid,
       offset by its margin and the sub-cell shift, divided by dpr for CSS
       pixels, with y flipped. */
    updateBars() {
        const g = this.grid;
        const w = g.cols * g.cellW;
        const h = g.rows * g.cellH;
        const each = (e) => {
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
            /* Eight characters wide; never fewer than one filled while alive. */
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
            e.bar.style.transform = `translate(${((g.offX + this.shiftX + ((tmp.x + 1) / 2) * w) / g.dpr).toFixed(1)}px, ${((g.height - g.offY - this.shiftY - ((tmp.y + 1) / 2) * h) / g.dpr).toFixed(1)}px)`;
        };
        this.creatures.forEach(each);
        this.leaving.forEach((e) => e.bar && each(e));
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
            const left = (g.offX + this.shiftX + ((tmp.x + 1) / 2) * w) / g.dpr;
            const top = (g.height - g.offY - this.shiftY - ((tmp.y + 1) / 2) * h) / g.dpr;
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
        /* Back-dated so the swing is already under way. */
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
        /* Slain: hurt within the last 1.5 s, or struck by you within 0.8 s and 1.6
           tiles. A slain one falls (hp 0 shows the down pose) and lingers 0.8 s;
           anything else just shrinks and spins away. */
        entity.slain = (entity.hurtAt !== undefined && this.time - entity.hurtAt < 1.5) || Boolean(struckBySelf);
        if (entity.slain && entity.data) entity.data = { ...entity.data, hp: 0 };
        if (entity.slain && entity.kind) this.emit("slain", { x: entity.pos.x, z: entity.pos.z, creature: entity.kind });
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
            /* After lingering, shrinks away over 0.45 s. */
            const k = (age - linger) / 0.45;
            if (k >= 1) {
                this.scene.remove(e.model);
                disposeMerged(e.model);
                return false;
            }
            const scale = e.baseScale * (1 - k * k);
            e.model.scale.setScalar(Math.max(0.001, scale));
            if (!e.slain) e.model.rotation.y += 0.25;
            return true;
        });
    }

    setPhase(phase, weather) {
        /* The first word on the time of day is taken at once, so a visit
           at night does not open on a sunset; after that it is eased in. */
        if (!this.phaseName) this.phaseSnap = true;
        /* Unknown names fall back to day and clear. */
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

    /* 60 rings recycled at random spots within 11 tiles of the view; `life`
       counts down at 2.5 a second and each ring widens as it runs out. */
    updateSplashes(dt, on) {
        const mesh = this.splashes;
        mesh.visible = on;
        if (!on) return;
        const life = mesh.userData.life;
        const m = m4;
        for (let i = 0; i < life.length; i += 1) {
            life[i] -= dt * 2.5;
            if (life[i] <= 0) {
                life[i] = 0.4 + Math.random() * 0.6;
                const x = Math.round(this.focus.x + (Math.random() - 0.5) * 22);
                const z = Math.round(this.focus.z + (Math.random() - 0.5) * 22);
                mesh.userData[i] = [x + Math.random() - 0.5, Math.max(WATER_LEVEL, this.ground.height(x, z)) + 0.04, z + Math.random() - 0.5];
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

    /* Everything that gives off light, gathered when the structures change
       rather than every frame. */
    refreshFires() {
        if (!this.firesDirty) return;
        this.firesDirty = false;
        this.lit = [];
        this.fires = [];
        this.structures.forEach((s) => {
            const light = s.group.userData.light;
            if (!light) return;
            this.lit.push({ s, light, d: 0 });
            /* A furnace lights its surroundings but sends up no embers. */
            if (s.kind !== "furnace") this.fires.push({ at: s.group.position.clone().setY(s.group.position.y + light.y - 0.3), d: 0 });
        });
    }

    updateEmbers() {
        const list = this.fires;
        const mesh = this.embers;
        mesh.visible = list.length > 0 && !this.reducedMotion;
        if (!mesh.visible) return;
        list.forEach((f) => (f.d = f.at.distanceToSquared(this.focus)));
        list.sort((a, b) => a.d - b.d);
        const m = m4;
        /* Each seed [a, b, c] fixes one ember's phase, speed and sideways drift;
           they are dealt out round the nearest six fires. */
        mesh.userData.seeds.forEach(([a, b, c], i) => {
            const fire = list[i % Math.min(list.length, 6)].at;
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
        /* Targets: stars come out by night and fade behind cloud; cloud cover
           follows the weather. Both ease at the lighting's rate (`k`), or jump on the
           first snapshot. This clears phaseSnap, so it must run after
           updateLighting, which reads it too. */
        const stars = { night: 1, dusk: 0.45, dawn: 0.3, day: 0 }[this.phaseName || "day"];
        const clouds = { clear: 0.15, fog: 0.5, rain: 0.75, storm: 1 }[this.weather || "clear"];
        const k = this.phaseSnap ? 1 : Math.min(1, dt * 0.45);
        this.phaseSnap = false;
        u.uStars.value += (stars * (1 - clouds * 0.6) - u.uStars.value) * k;
        u.uClouds.value += (clouds - u.uClouds.value) * k;
        const day = this.phaseName === "day" || this.phaseName === "dawn";
        const tint = goalColor.setHex(day ? 0x3c4a66 : 0x283350);
        if (this.flash > 0.2) tint.setHex(0x8f9fd0);
        u.uCloudColor.value.lerp(tint, this.flash > 0.2 ? 1 : k);
        /* Turning the camera slides the sky along: a screen's width of columns
           for every 1.4 radians of yaw. */
        u.uSkyShift.value = (-this.yaw / 1.4) * this.grid.cols;
    }

    /* Someone walking under their own steam: the body decides where they
       are, and the figure follows it exactly, a hand's height up and down
       the terraces. Returns how far they moved and whether they walk. */
    followBody(entity, dt) {
        const b = entity.driven;
        const moved = Math.hypot(b.x - entity.pos.x, b.y - entity.pos.z);
        const ground = this.entityHeight(Math.round(b.x), Math.round(b.y));
        /* x and z are the body's exactly; only the height is eased. */
        const h = entity.pos.y + (ground - entity.pos.y) * Math.min(1, dt * 18);
        entity.pos.set(b.x, h, b.y);
        if (b.facing !== undefined && b.speed > 0.3) entity.facing = b.facing;
        if (b.speed > 0.3) entity.lastStep = this.time;
        return { moved, walking: b.speed > 0.4 };
    }

    /* One entity for one frame: place `pos` from the driven body, or from how
       far along its from -> to walk it is (`t`, of `duration`), then finishEntity. */
    updateEntity(entity, dt) {
        if (entity.driven) {
            const { moved, walking } = this.followBody(entity, dt);
            this.finishEntity(entity, dt, moved, walking);
            return;
        }
        const t = entity.duration > 0 ? Math.min(1, (this.time - entity.start) / entity.duration) : 1;
        const x = entity.from.x + (entity.to.x - entity.from.x) * t;
        const z = entity.from.y + (entity.to.y - entity.from.y) * t;
        const moved = Math.hypot(x - entity.pos.x, z - entity.pos.z);
        const fromH = entity.fromH ?? this.entityHeight(entity.from.x, entity.from.y);
        const toH = this.entityHeight(entity.to.x, entity.to.y);
        const climb = Math.abs(toH - fromH) > 0.05;
        /* Up or down a terrace, the feet follow how far along the step the
           body really is, and ease over the lip, so nothing hops ahead of
           the walk. */
        const lift = (s) => {
            const e = s * s * (3 - 2 * s);
            return fromH + (toH - fromH) * e + Math.sin(s * Math.PI) * (climb ? 0.1 : 0);
        };
        const h = lift(t);
        if (entity.glide) {
            /*
             * People glide. The server moves everyone a whole tile at a time,
             * along the grid, so a diagonal arrives as a zigzag; easing
             * toward each step instead of landing on it smooths the zigzag
             * into the straight line that was meant, and the body turns to
             * the way it is really going.
             */
            /* Frame-rate independent easing: the same fraction of the gap closes per
               second whatever dt is (the camera's easing below is the same shape). */
            const k = 1 - Math.exp(-dt * 13);
            const gx = entity.pos.x + (x - entity.pos.x) * k;
            const gz = entity.pos.z + (z - entity.pos.z) * k;
            const vx = gx - entity.pos.x;
            const vz = gz - entity.pos.z;
            if (Math.hypot(vx, vz) > dt * 0.8) entity.facing = Math.atan2(vx, vz);
            const sx = entity.to.x - entity.from.x;
            const sz = entity.to.y - entity.from.y;
            const span = sx * sx + sz * sz;
            const along = span > 1e-6 ? Math.min(1, Math.max(0, ((gx - entity.from.x) * sx + (gz - entity.from.y) * sz) / span)) : 1;
            entity.pos.set(gx, climb ? lift(along) : h, gz);
        } else entity.pos.set(x, h, z);
        /* Counts as walking for a moment after the last step (longer for the slow
           creatures), so a run of steps does not flick between idle and walk. */
        const walking = this.time - entity.lastStep < (entity.duration > 0.3 ? 0.55 : 0.28);
        this.finishEntity(entity, dt, moved, walking);
    }

    /* What every figure does each frame, however it got where it is: stride,
       turning, hurt, falling and rising, the pop-in, the pose. */
    finishEntity(entity, dt, moved, walking) {
        entity.moving += ((walking ? 1 : 0) - entity.moving) * Math.min(1, dt * 12);
        /* Stride phase grows 4.6 per tile moved; a foot lands every PI of it. */
        entity.stride += moved * 4.6;
        /* A foot comes down each half turn of the stride. */
        if (entity === this.self) {
            const plant = Math.floor(entity.stride / Math.PI);
            if (plant !== entity.plant && entity.moving > 0.5 && !(entity.data?.hp <= 0)) {
                const x = Math.round(entity.pos.x);
                const z = Math.round(entity.pos.z);
                this.emit("step", { x: entity.pos.x, z: entity.pos.z, wet: this.ground.tile(x, z) === WATER && !this.bridged(x, z), built: this.bridged(x, z) });
            }
            entity.plant = plant;
        }
        entity.yaw = lerpAngle(entity.yaw, entity.facing, Math.min(1, dt * 14));
        entity.model.rotation.y = entity.yaw;
        entity.hurt = Math.max(0, entity.hurt - dt * 2.8);
        const dead = entity.data && entity.data.hp <= 0;
        /* 0 up, 1 down; takes about 0.6 s either way. */
        entity.down = Math.min(1, Math.max(0, entity.down + (dead ? dt : -dt) * 1.6));
        flashModel(entity.model, this.time < entity.flashUntil);

        /* New arrivals pop up out of the ground with a little overshoot. */
        const age = (this.time - entity.born) / 0.4;
        if (age < 1) {
            const k = age - 1;
            /* An ease-out-back curve (overshoot constant 1.7). */
            entity.model.scale.setScalar(entity.baseScale * Math.max(0.001, 1 + 2.7 * k * k * k + 1.7 * k * k));
        } else if (entity.model.scale.x !== entity.baseScale) {
            entity.model.scale.setScalar(entity.baseScale);
        }

        pose(entity.model, {
            stride: entity.stride,
            moving: entity.moving,
            /* Offset each figure's clock so idle crowds don't breathe in step. */
            t: this.time + entity.seed,
            /* 0..1 across a half-second swing. */
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
        /* Which chunks are wanted only changes on crossing into another
           chunk, zooming, or a new snapshot; between those, only the queue
           is worked through. */
        const scan = this.chunkScan;
        if (this.chunksDirty || !scan || scan.cx !== cx || scan.cy !== cy || Math.abs(scan.radius - radius) > 1) {
            this.chunksDirty = false;
            this.chunkScan = { cx, cy, radius };
            this.scanChunks(cx, cy, radius);
        }
        if (!this.chunkQueue.length) return;
        /* The first view goes up whole; after that, as many as fit in the
           frame's budget, nearest first, and always at least one. */
        const all = this.chunks.size === 0;
        const start = now();
        while (this.chunkQueue.length && (all || now() - start < CHUNK_BUDGET_MS)) {
            const w = this.chunkQueue.shift();
            const old = this.chunks.get(w.key);
            const group = buildChunk(w.x, w.y, new Set(w.list), this.ground);
            this.scene.add(group);
            if (old) this.dropChunk(old);
            this.chunks.set(w.key, { group, signature: w.signature, x: w.x, y: w.y });
        }
    }

    /*
     * Work out which chunks within `radius` tiles of the view are missing or
     * stale (their signature differs from the one built), nearest first, into
     * chunkQueue, and drop built ones beyond it. The drop margin (2 chunks) is
     * wider than the build margin (0.7 of a chunk), so a chunk on the edge is not
     * built and dropped in turn.
     */
    scanChunks(cx, cy, radius) {
        const reach = Math.ceil(radius / CHUNK);
        const wanted = [];
        for (let y = cy - reach; y <= cy + reach; y += 1) {
            for (let x = cx - reach; x <= cx + reach; x += 1) {
                const mx = (x + 0.5) * CHUNK;
                const my = (y + 0.5) * CHUNK;
                const d = Math.hypot(mx - this.focus.x, my - this.focus.z);
                if (d > radius + CHUNK * 0.7) continue;
                const key = `${x}:${y}`;
                const cleared = this.clearedByChunk.get(key);
                /* Stale when its harvested tiles or the ground edits in and around it differ. */
                const signature = `${cleared ? cleared.signature : ""}#${this.ground.chunkSignature(x, y)}`;
                const have = this.chunks.get(key);
                if (!have || have.signature !== signature) wanted.push({ key, x, y, d, list: cleared ? cleared.list : [], signature });
            }
        }
        wanted.sort((a, b) => a.d - b.d);
        this.chunkQueue = wanted;

        this.chunks.forEach((chunk, key) => {
            const d = Math.hypot((chunk.x + 0.5) * CHUNK - this.focus.x, (chunk.y + 0.5) * CHUNK - this.focus.z);
            if (d > radius + CHUNK * 2) {
                this.dropChunk(chunk);
                this.chunks.delete(key);
            }
        });
    }

    /* Frees geometry only; materials are shared (materials.js) and given back
       in dispose(). */
    dropChunk(chunk) {
        this.scene.remove(chunk.group);
        chunk.group.traverse((node) => {
            if (node.geometry) node.geometry.dispose();
        });
    }

    /*
     * Per frame: ease the lights toward the phase and weather, fire lightning,
     * set fog and the ASCII pass's lighting uniforms, aim the sun with its shadow
     * box following the view, and hand the nearest fires the pool of real lights.
     * `k` below is the easing rate, 1 on the first snapshot so it opens at the
     * right time of day.
     */
    updateLighting(dt) {
        const goal = PHASES[this.phaseName || "day"];
        const dimming = WEATHER_DIM[this.weather || "clear"];
        /* Dawn and dusk take their time: a few seconds of the light
           warming or draining, rather than a cut. */
        const k = this.phaseSnap ? 1 : Math.min(1, dt * 0.45);
        const p = this.phase;
        p.sun += (goal.sun * dimming - p.sun) * k;
        p.hemi += (goal.hemi * dimming - p.hemi) * k;
        p.angle += (goal.angle - p.angle) * k;
        p.sunColor.lerp(goalColor.set(goal.sunColor), k);
        p.sky.lerp(goalColor.set(goal.sky), k);
        p.ground.lerp(goalColor.set(goal.ground), k);
        p.bg.lerp(goalColor.set(goal.bg), k);

        /* Lightning, in storms only: a strike every 5 to 14 s sets `flash` to 1,
           which decays at 4 a second (and only decays inside this branch). */
        let flash = 0;
        if (this.weather === "storm" && !this.reducedMotion) {
            this.nextFlash -= dt;
            if (this.nextFlash <= 0) {
                this.flash = 1;
                this.nextFlash = 5 + Math.random() * 9;
                this.emit("thunder");
            }
            this.flash = Math.max(0, this.flash - dt * 4);
            /* Two pulses as it decays: above 0.5, then briefly between 0.3 and 0.2. */
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
        /* The clear alpha is a glyph code too: empty cells read as set 0. */
        this.renderer.setClearColor(this.scene.fog.color, glyphCode(0));
        /* Colours live in linear space; the ASCII pass writes sRGB. */
        this.ascii.uniforms.uBackground.value.copy(p.bg).convertLinearToSRGB();
        /* A wash of each cell's colour behind its character, so shapes read
           as masses at a glance; more at night, when the type is thinner. */
        const u = this.ascii.uniforms;
        u.uFill.value += ((this.phaseName === "night" ? 0.6 : 0.52) - u.uFill.value) * k;
        u.uGlow.value += ((this.phaseName === "night" ? 1.2 : 0.5) - u.uGlow.value) * k;
        /* Flat walls thin out as they darken, so cabins read as timber
           rather than as slabs of # and %. */
        this.ascii.uniforms.uContrast.value = 1.7;
        /* The active camera's depth range, so the pass can turn depth back into
           distance (the isometric and first-person cameras differ). */
        this.ascii.uniforms.uNear.value = this.camera.near;
        this.ascii.uniforms.uFar.value = this.camera.far;

        /* The sun swings around a little with the time of day. Its shadow
           camera follows you in whole shadow-map texels, so shadows hold
           still while you walk instead of crawling along their edges. */
        const a = p.angle;
        lightDir.set(-10 * Math.cos(a), 18 * Math.sin(a) + 4, 8).normalize();
        lightRight.crossVectors(WORLD_UP, lightDir).normalize();
        lightUp.crossVectors(lightDir, lightRight);
        /* Just wide enough for what is on screen and the tall things just
           off it, in steps so zooming does not resize it every frame. A
           tighter box puts the same map's texels closer together and leaves
           more of the far field out of the shadow pass. */
        const sc = this.sun.shadow.camera;
        const half = Math.min(40, Math.ceil((this.distance * 1.3 + 6) / 2) * 2);
        if (sc.right !== half) {
            sc.left = -half;
            sc.right = half;
            sc.top = half;
            sc.bottom = -half;
            sc.updateProjectionMatrix();
        }
        const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
        const fr = this.focus.dot(lightRight);
        const fu = this.focus.dot(lightUp);
        tmp.copy(this.focus)
            .addScaledVector(lightRight, Math.round(fr / texel) * texel - fr)
            .addScaledVector(lightUp, Math.round(fu / texel) * texel - fu);
        this.sun.target.position.copy(tmp);
        /* The same offset as lightDir, from the snapped target. */
        this.sun.position.set(tmp.x - 10 * Math.cos(a), tmp.y + 18 * Math.sin(a) + 4, tmp.z + 8);

        /* The nearest fires get real lights; there are only so many. */
        this.refreshFires();
        const lit = this.lit;
        lit.forEach((entry) => (entry.d = entry.s.group.position.distanceToSquared(this.focus)));
        lit.sort((x, y) => x.d - y.d);
        this.nearestFire = lit.length ? Math.sqrt(lit[0].d) : Infinity;
        /* Fire light multiplier: strongest at night, weakest by day. */
        const night = this.phaseName === "night" ? 1.6 : this.phaseName === "day" ? 0.6 : 1.1;
        this.lightPool.forEach((light, i) => {
            const entry = lit[i];
            if (!entry) {
                light.intensity = 0;
                return;
            }
            const flicker = this.reducedMotion ? 1 : 0.85 + Math.sin(this.time * 13 + i * 3) * 0.08 + Math.sin(this.time * 7.3 + i) * 0.07;
            /* `entry.light` is { color, range, y } from the structure's userData.light
               (models.js); `y` is the height above its base. */
            light.color.setHex(entry.light.color);
            light.distance = entry.light.range * 1.3;
            light.intensity = 4.5 * flicker * night;
            light.position.copy(entry.s.group.position);
            light.position.y += entry.light.y;
        });
    }

    /* Looking out of your own eyes: at 1.55 times the body's scale above its
       feet, along yaw (flat on the ground plane) tilted by pitch. Your own
       model is hidden and the cutaway is off. */
    updateFirstPerson(self) {
        const cam = this.fpCamera;
        this.yaw = this.yawGoal;
        this.distance = this.distanceGoal;
        const eye = self.pos.y + 1.55 * (self.baseScale || 1);
        cam.position.set(self.pos.x, eye, self.pos.z);
        const flat = Math.cos(this.pitch);
        cam.lookAt(self.pos.x - Math.sin(this.yaw) * flat, eye + Math.sin(this.pitch), self.pos.z - Math.cos(this.yaw) * flat);
        cam.updateMatrixWorld();
        this.focus.copy(self.pos);
        self.model.visible = false;
        this.shiftX = 0;
        this.shiftY = 0;
        this.ascii.setShift(0, 0);
        aimCutaway(cam, self.pos, { on: false });
        this.water.position.x = Math.round(this.focus.x);
        this.water.position.z = Math.round(this.focus.z);
    }

    updateCamera(dt) {
        const self = this.self;
        if (this.firstPerson && self && !this.orbit) {
            if (this.selfFacing !== null) {
                self.facing = this.selfFacing;
                this.selfFacing = null;
            }
            this.updateFirstPerson(self);
            return;
        }
        let goal;
        if (self) goal = self.pos;
        else if (this.state?.view) {
            goal = tmp.set(this.state.view.x + this.state.view.w / 2, 0, this.state.view.y + this.state.view.h / 2);
            goal.y = this.ground.height(Math.round(goal.x), Math.round(goal.z));
        }
        if (goal) {
            if (!this.focusReady) {
                this.focus.copy(goal);
                this.focusReady = true;
            } else {
                /* Follow closely across the ground, so you stay near the
                   middle while walking; settle more slowly up and down, so
                   terraces don't bob the whole view. */
                const k = 1 - Math.exp(-dt * 11);
                const ky = 1 - Math.exp(-dt * 4);
                this.focus.x += (goal.x - this.focus.x) * k;
                this.focus.z += (goal.z - this.focus.z) * k;
                this.focus.y += (goal.y - this.focus.y) * ky;
            }
        }
        if (self && this.selfFacing !== null) {
            self.facing = this.selfFacing;
            this.selfFacing = null;
        }

        /* Orbit turns the view by itself at 0.08 radians a second. Yaw and
           distance ease with 1 - exp(-dt * rate), as above. */
        if (this.orbit) this.turnAngle = (this.turnAngle ?? ISO_YAW) + dt * 0.08;
        const goalYaw = this.orbit ? this.turnAngle : this.yawGoal;
        this.yaw = this.orbit ? goalYaw : lerpAngle(this.yaw, goalYaw, 1 - Math.exp(-dt * 9));
        this.distance += (this.distanceGoal - this.distance) * (1 - Math.exp(-dt * 10));

        placeIsoCamera(this.camera, this.focus, this.yaw, this.distance, this.camera.userData.aspect || 1.6);
        /* Whole cells only, so the picture does not crawl as it follows. */
        snapIsoCamera(this.camera, this.grid.cols, this.grid.rows, this.cellShift, this.slack);
        /* The sub-cell remainder of the snap, in device pixels, so the picture
           still slides smoothly under the characters. */
        this.shiftX = Math.round(this.slack.x * this.grid.cellW);
        this.shiftY = Math.round(this.slack.y * this.grid.cellH);
        this.ascii.setShift(this.shiftX, this.shiftY);
        this.ascii.uniforms.uCellShift.value.copy(this.cellShift);
        if (this.shake > 0 && !this.reducedMotion) {
            this.shake = Math.max(0, this.shake - dt);
            /* A blow knocks the view about and lets it settle: a couple of
               fast, unrelated wobbles dying away, rather than a fresh random
               jump every frame, which reads as a glitch more than a hit. */
            const k = this.shake * this.shake * 0.5;
            const t = this.time * 38;
            this.camera.position.x += (Math.sin(t) * 0.6 + Math.sin(t * 1.7 + 1.3) * 0.4) * k;
            this.camera.position.y += (Math.sin(t * 1.3 + 0.7) * 0.6 + Math.sin(t * 2.1) * 0.4) * k;
            this.camera.updateMatrixWorld();
        }
        /* Cut away whatever stands between the camera and you, out of an oval
           (half-width and half-height, world units) that grows with the zoom.
           Off in orbit, or with nobody to look after. */
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

    /* Player name tags (registered by React): placed 2 units above the head and
       hidden when off screen, behind the camera, or when their player is gone. */
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
            const left = (g.offX + this.shiftX + ((tmp.x + 1) / 2) * w) / g.dpr;
            const top = (g.height - g.offY - this.shiftY - ((tmp.y + 1) / 2) * h) / g.dpr;
            el.style.visibility = "visible";
            el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
        });
    }

    /*
     * One animation frame. The governor gets the real frame time while the
     * simulation gets `dt`, capped at 0.1 s so a hitch or a hidden tab does not
     * make everything leap. Order: entities, camera, chunks, lighting (see the
     * header), then the two passes.
     */
    frame() {
        this.raf = requestAnimationFrame(this.frame);
        const begin = now();
        const raw = this.clock.getDelta();
        this.governor.sample(raw * 1000);
        const dt = Math.min(0.1, raw);
        this.time += dt;
        this.renderer.info.reset();

        this.players.forEach((p) => this.updateEntity(p, dt));
        this.creatures.forEach((c) => this.updateEntity(c, dt));
        this.updateLeaving(dt);
        this.updateSparks();
        this.puffs.update(this.time);
        this.updateCamera(dt);
        this.updateChunks();
        this.updateLighting(dt);
        this.updateRain(dt);
        this.updateSky(dt);
        this.updateEmbers();
        wind.uTime.value = this.reducedMotion ? 0 : this.time;
        this.updateCursor();
        this.ghosts.update(this.time, this.reducedMotion);

        this.structures.forEach((s) => {
            const born = s.group.userData.born;
            if (born !== undefined) {
                /* A quick rise with a little settle at the top. */
                const t = Math.min(1, (this.time - born) / 0.28);
                s.group.scale.y = t >= 1 ? 1 : 0.05 + 0.95 * (1 - (1 - t) ** 3) * (1 + Math.sin(t * Math.PI) * 0.12);
                if (t >= 1) delete s.group.userData.born;
            }
            /* A door: userData.open (0 or 1, from syncStructures) is the target, and
               the hinge eases toward a quarter turn at 10 a second. */
            const hinge = s.group.userData.hinge;
            if (hinge) hinge.rotation.y += (-s.group.userData.open * Math.PI * 0.5 - hinge.rotation.y) * Math.min(1, dt * 10);
        });
        this.flames.forEach((f, i) => {
            const n = this.reducedMotion ? 0 : Math.sin(this.time * 11 + i * 1.7) * 0.12 + Math.sin(this.time * 17 + i) * 0.08;
            f.scale.y = f.scale.x * (1 + n);
            f.rotation.y = this.time * 1.5 + i;
        });
        /* With reduced motion the sea is laid flat once and then left alone. */
        if (!this.reducedMotion || !this.waterStill) {
            rippleWater(this.water, this.time, this.reducedMotion);
            this.waterStill = this.reducedMotion;
        }

        /* Two passes: the scene into the ASCII pass's target, then the pass draws
           characters to the canvas. The uniforms between describe this frame's
           camera, so they are set after the camera moved. */
        this.renderer.setRenderTarget(this.ascii.target);
        this.renderer.render(this.scene, this.camera);
        this.ascii.uniforms.uFlash.value = this.flash > 0.2 ? 1 : 0;
        this.ascii.uniforms.uOrtho.value = this.camera.isOrthographicCamera ? 1 : 0;
        this.ascii.uniforms.uInvProj.value.copy(this.camera.projectionMatrixInverse);
        this.ascii.uniforms.uCamToWorld.value.copy(this.camera.matrixWorld);
        this.ascii.render(this.renderer, this.camera);
        this.updateLabels();
        this.updateBars();
        this.updateFloaters();
        if (this.perf) {
            this.perf.frame(now() - begin, this.renderer.info, {
                chunks: `${this.chunks.size} (+${this.chunkQueue.length} queued)`,
                cells: `${this.grid.cols}x${this.grid.rows}`,
                q: `${this.governor.level} (shadow ${this.quality.shadow || "off"}, cell x${this.quality.cell})`,
            });
        }
    }

    /* Idempotent. Gives back what init() took: the frame loop and observers,
       chunk geometry, figure holds, structures, ghosts, puffs, listeners, the
       pass, the DOM layers, the material hold, then the renderer. Called by
       AsciiField on unmount. */
    dispose() {
        /* Closing twice frees nothing twice, and gives back the material
           hold only once. */
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.raf);
        /* The cutaway uniforms are shared module-wide (iso.js); switch the cut
           off so the next scene does not inherit this one's. */
        CUT.uCutOn.value = 0;
        this.observer.disconnect();
        this.unwatchPixelRatio?.();
        this.chunks.forEach((c) => this.dropChunk(c));
        this.chunks.clear();
        this.players.forEach((e) => disposeMerged(e.model));
        this.creatures.concat(this.leaving).forEach((e) => disposeMerged(e.model));
        this.structures.forEach((s) => {
            disposeModel(s.group);
            disposeMerged(s.group);
        });
        this.ghosts.dispose();
        this.puffs.dispose();
        this.listeners.clear();
        this.ascii.dispose();
        if (this.perf) this.perf.dispose();
        this.fxLayer.remove();
        this.materials?.release();
        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}

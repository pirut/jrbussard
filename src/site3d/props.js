import * as THREE from "three";
import { KIND } from "../world/tiles";
import { material, ownMaterial } from "../arcade/ascii3d/materials";
import { buildStructure, buildSurvivor } from "../arcade/ascii3d/models";
import { releaseFigure } from "../arcade/ascii3d/figureGeometry";

/*
 * The things in the workshop you walk up to, as models.
 *
 * Every marker the tile world knows about (a book on a shelf, a machine, a
 * star, a cabinet, a terminal) gets one of these. Each is lit when there is
 * something behind it — a note in that slot, a repository for that star —
 * and goes cold when there is not, the same promise the character world made
 * with its glow.
 *
 * Coordinates follow the Commons: one tile is one unit, x east, z south.
 * Each builder draws around the origin of its own tile: the caller positions
 * the group at the marker's tile and the standing height.
 *
 * Contract of every builder, as buildProp returns it:
 *   { group, update(t, lit, seed), light? }
 * `group` is a THREE.Group; `update` is called every frame by
 * SiteScene.updateProps (t = scene seconds, 0 under reduced motion; lit =
 * whether there is content behind this prop, from the counts World.js sets;
 * seed = a per-prop phase so neighbours do not pulse together); `light`,
 * when present, is {y, range, color} and is only a description: the scene
 * owns a small pool of real point lights (MAX_LIGHTS, SiteScene.js) and
 * lends them to the nearest lit props each frame, since a light per prop
 * would be far past what the renderer can afford.
 *
 * Callers: SiteScene.buildProps and Diorama (arcade cabinets, the signpost,
 * torches). This file does not decide what a prop opens or whether it is lit
 * (World.js and the counts do) and does no placement.
 *
 * Disposal: geometries below live in a module-level cache for the life of
 * the page and are never freed, because they are shared across scenes and
 * there are only a handful of distinct shapes. Materials are the opposite: shared
 * palette materials come from materials.js and are freed with the scene's
 * retainMaterials() hold, but the "glow" materials here change colour per
 * prop, so each prop has its own and disposeProps frees them.
 */

/* Shared geometry by key, built on first use. */
const geometries = new Map();
function geo(key, make) {
    if (!geometries.has(key)) geometries.set(key, make());
    return geometries.get(key);
}
/* Boxes are keyed by size, so a repeated size across props is one geometry. */
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));

function mesh(geometry, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

/* A material whose colour flips between lit and cold. Unlit (basic) so it
   keeps its colour at night when the scene lighting is low: "lit" has to
   read as lit whatever the sun is doing. Flagged userData.own for
   disposeProps. */
function glow(lit, cold, set = "fire") {
    const mat = ownMaterial(lit, set, { unlit: true });
    mat.userData.own = true;
    mat.userData.lit = new THREE.Color(lit);
    mat.userData.cold = new THREE.Color(cold);
    return mat;
}

/* Cheap per-frame switch: copy one of the two stored colours, no allocation. */
function setLit(mat, on) {
    mat.color.copy(on ? mat.userData.lit : mat.userData.cold);
}

const TIMBER_DARK = "#7a5a3c";
const STONE = "#8f978f";
const SPINES = ["#e0a35e", "#c8735a", "#d9c27a", "#8fb0a0", "#b48ab8"];

/* A bookshelf: `marker.index` is this slot's rank among its room's shelves
   in reading order (assigned in world/build.js), and the same rank decides
   which note it holds, so the first shelf shows the newest note. It is also
   what varies the spine colours and heights, deterministically, so a shelf
   looks the same on every load. Two rows of four spines face south (+z). */
function bookshelf(marker) {
    const g = new THREE.Group();
    g.add(mesh(box(0.96, 0.9, 0.62), material(TIMBER_DARK, "timber"), 0, 0.45, 0));
    const spines = [];
    for (let i = 0; i < 4; i += 1) {
        const colour = SPINES[(marker.index + i) % SPINES.length];
        const mat = glow(colour, "#3b332b", "timber");
        const h = 0.24 + ((marker.index * 7 + i * 3) % 4) * 0.04;
        spines.push(mat);
        g.add(mesh(box(0.16, h, 0.1), mat, -0.32 + i * 0.21, 0.5 + h / 2 - 0.12, 0.33));
        g.add(mesh(box(0.16, h, 0.1), mat, -0.32 + i * 0.21, 0.16 + h / 2 - 0.08, 0.33));
    }
    return {
        group: g,
        light: { y: 0.6, range: 2.5, color: 0xe0a35e },
        update(t, lit) {
            spines.forEach((m) => setLit(m, lit));
        },
    };
}

/* A machine on the foundry line: a housing with a turning core inside. */
function machine() {
    const g = new THREE.Group();
    g.add(mesh(box(0.96, 0.5, 0.96), material("#6f675f", "rock"), 0, 0.25, 0));
    const core = mesh(geo("core", () => new THREE.OctahedronGeometry(0.34, 0)), glow("#7ee0c0", "#2f3f3a"), 0, 0.95, 0);
    g.add(core);
    const ring = mesh(geo("ring", () => new THREE.TorusGeometry(0.42, 0.05, 4, 12)), material("#c8d2ce", "solid"), 0, 0.95, 0);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    return {
        group: g,
        light: { y: 1.0, range: 4, color: 0x7ee0c0 },
        update(t, lit) {
            setLit(core.material, lit);
            core.rotation.y = lit ? t * 1.4 : 0;
            core.position.y = 0.95 + (lit ? Math.sin(t * 2) * 0.06 : -0.15);
            ring.rotation.z = lit ? -t * 0.8 : 0;
        },
    };
}

/* A repository: a star turning over a small brass mount. A dim, slow, nearly
   still star when it has no repository behind it. `seed` offsets the phase. */
function star() {
    const g = new THREE.Group();
    g.add(mesh(geo("mount", () => new THREE.CylinderGeometry(0.12, 0.3, 0.6, 6)), material("#b49a6a", "timber"), 0, 0.3, 0));
    const gem = mesh(geo("star", () => new THREE.OctahedronGeometry(0.4, 0)), glow("#ffd977", "#4a4536"), 0, 1.25, 0);
    gem.scale.set(1, 1.3, 1);
    g.add(gem);
    return {
        group: g,
        light: { y: 1.3, range: 4, color: 0xffd977 },
        update(t, lit, seed) {
            setLit(gem.material, lit);
            gem.rotation.y = t * (lit ? 0.9 : 0.15) + seed;
            gem.position.y = 1.25 + Math.sin(t * 1.3 + seed) * (lit ? 0.12 : 0.02);
        },
    };
}

/* An arcade cabinet's screen and controls. The case around it is built
   from the room's own wall tiles, so only the face is here. The screen hue
   is picked by `marker.index` so a row of cabinets is a row of colours
   (Diorama's arcade builds six, with indexes 0-5, one of each hue). */
function cabinet(marker) {
    const g = new THREE.Group();
    g.add(mesh(box(0.96, 1.3, 0.8), material("#3e3346", "solid"), 0, 0.65, 0));
    const hues = ["#ff7ad9", "#7fd7ff", "#ffd977", "#9fe0a8", "#ff9d6a", "#b799c6"];
    const screen = mesh(box(0.7, 0.5, 0.06), glow(hues[marker.index % hues.length], "#1d1a22"), 0, 1.0, 0.4);
    screen.rotation.x = -0.25;
    g.add(screen);
    g.add(mesh(box(0.9, 0.12, 0.3), material("#6b5a78", "solid"), 0, 0.62, 0.46));
    const button = mesh(box(0.12, 0.06, 0.12), glow("#ffffff", "#444444"), 0.2, 0.7, 0.5);
    g.add(button);
    return {
        group: g,
        light: { y: 1.0, range: 3, color: 0xff7ad9 },
        update(t, lit, seed) {
            setLit(screen.material, lit);
            setLit(button.material, lit && Math.sin(t * 5 + seed) > 0);
        },
    };
}

/* A terminal: a pedestal and a tilted green screen. Always on (it ignores
   `lit`; nothing counts against it), with a rare brief dropout of the
   screen for life. */
function terminal() {
    const g = new THREE.Group();
    g.add(mesh(box(0.5, 0.8, 0.5), material("#5d6066", "solid"), 0, 0.4, 0));
    const screen = mesh(box(0.8, 0.5, 0.08), glow("#8ce8b4", "#22332a"), 0, 1.0, 0.12);
    screen.rotation.x = -0.6;
    g.add(screen);
    return {
        group: g,
        light: { y: 1.1, range: 3.5, color: 0x8ce8b4 },
        update(t) {
            setLit(screen.material, Math.sin(t * 3.1) > -0.95);
        },
    };
}

/* The signpost comes from the Commons' own structure kit, so the site and
   the Commons share one sign. Same for the torch below. */
function signpost() {
    const g = buildStructure({ kind: "sign" }, {});
    g.scale.setScalar(1.25);
    return { group: g, update() {} };
}

/* The beacon at the end of the pier: a striped tower and a turning lamp. */
function lighthouse() {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i += 1) {
        const r0 = 0.5 - i * 0.07;
        const r1 = 0.5 - (i + 1) * 0.07;
        g.add(
            mesh(
                geo(`tower${i}`, () => new THREE.CylinderGeometry(r1, r0, 0.7, 10)),
                material(i % 2 ? "#c75f4f" : "#e8e2d0", "solid"),
                0,
                0.35 + i * 0.7,
                0,
            ),
        );
    }
    g.add(mesh(geo("gallery", () => new THREE.CylinderGeometry(0.42, 0.42, 0.08, 10)), material(STONE, "rock"), 0, 2.84, 0));
    const lamp = mesh(geo("lamp", () => new THREE.SphereGeometry(0.22, 10, 8)), glow("#7fd7ff", "#2b3a44"), 0, 3.08, 0);
    g.add(lamp);
    g.add(mesh(geo("cap", () => new THREE.ConeGeometry(0.34, 0.4, 10)), material("#c75f4f", "solid"), 0, 3.5, 0));
    /* The beam: a long thin wedge that sweeps the water. */
    const beam = new THREE.Group();
    beam.position.y = 3.08;
    /* The cone's tip is translated to the origin so the beam pivots about the
       lamp, then laid on its side; the group is what turns (0.9 rad/s). */
    const ray = mesh(geo("beam", () => new THREE.ConeGeometry(0.22, 4.5, 6, 1, true).translate(0, -2.25, 0)), glow("#4f7f96", "#000000", "water"));
    ray.rotation.z = Math.PI / 2;
    ray.castShadow = false;
    beam.add(ray);
    g.add(beam);
    return {
        group: g,
        light: { y: 3.1, range: 12, color: 0x7fd7ff },
        update(t) {
            beam.rotation.y = t * 0.9;
        },
    };
}

/* The operator, cast on a plinth in the atrium. A real survivor model, so
   it takes a hold on shared figure geometry that disposeProps must give back. */
function statue() {
    const g = new THREE.Group();
    g.add(mesh(box(0.96, 0.4, 0.96), material(STONE, "rock"), 0, 0.2, 0));
    const figure = buildSurvivor({
        appearance: { skin: "bronze", hair: "ash", outfit: "ivory", cloak: "ochre", hairstyle: "cropped", headwear: "brim" },
    });
    figure.position.y = 0.4;
    figure.scale.setScalar(1.1);
    g.add(figure);
    return { group: g, update() {} };
}

/* Which tile kinds have a prop. Kinds absent here (walls, torches, which
   SiteScene builds separately via buildTorch) get none. */
const BUILDERS = {
    [KIND.BOOK]: bookshelf,
    [KIND.PROJECT]: machine,
    [KIND.REPO]: star,
    [KIND.ARCADE]: cabinet,
    [KIND.CONSOLE]: terminal,
    [KIND.SIGN]: signpost,
    [KIND.BEACON]: lighthouse,
    [KIND.STATUE]: statue,
};

/* A prop for a world marker ({kind, x, y, index, room} from world/build.js),
   or null for a kind with no model. Tags the group with userData.kind. */
export function buildProp(marker) {
    const make = BUILDERS[marker.kind];
    if (!make) return null;
    const prop = make(marker);
    prop.group.userData.kind = marker.kind;
    return prop;
}

/* Torches come straight from the Commons: same flame, same light. */
export function buildTorch() {
    const g = buildStructure({ kind: "torch" }, {});
    g.scale.setScalar(1.15);
    return g;
}

/* Free what a prop (or a torch) owns: its own glow materials, and any
   figure geometry it holds. Shared palette materials and the module's
   geometry cache are deliberately left alone. Safe to call twice. */
export function disposeProps(root) {
    root.traverse((node) => {
        if (node.material && node.material.userData?.own) node.material.dispose();
    });
    /* The statue is a survivor, and shares figure geometry. */
    releaseFigure(root);
}

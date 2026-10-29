import * as THREE from "three";
import { buildStructure } from "./models";
import { ownMaterial } from "./materials";

/*
 * The build ghost: the piece you are about to place, standing on the tile
 * it would go on, in green where it will go up and red where it won't. A
 * drag shows a whole run of them. Drawn unlit, so it reads the same by day
 * or night, and in the ASCII pass as a flat block of one colour that stands
 * apart from the lit, textured world around it.
 *
 * Owned by AsciiWorld (one Ghosts, fed by AsciiField's `ghosts` prop through
 * setGhosts), which gives each ghost's tile height from the same ground data
 * real structures use, so a ghost sits exactly where the piece would. Each
 * ghost is { x, y, kind, facing, ok, near }, x and y being map tiles. It is
 * only a picture: whether the piece can really be placed is decided by the
 * caller (`ok`, `near`) and finally by the server.
 *
 * Ownership: models come from buildStructure() and are rebuilt whenever the
 * signature changes; their meshes are re-pointed at one shared material per
 * colour (below, owned by the Ghosts and freed in dispose()). Nothing the
 * models came with is disposed here: not their geometry, and not any
 * material they replace (a torch's flame has two of its own, see models.js
 * flame(), which this overwrites and leaves undisposed on each rebuild).
 */

/* Green: will go up. Yellow: valid, but you would have to walk closer first
   (`near === false`). Red: will not go up. */
export const GHOST_OK = "#8fe39a";
export const GHOST_WALK = "#d9dd8a";
export const GHOST_BAD = "#ef7a62";

/* A thin slab just under a tile wide (0.96 x 0.96, 0.05 tall) under every
   ghost, marking the tile's footprint. */
const plateGeo = new THREE.BoxGeometry(0.96, 0.05, 0.96);

function tint(ghost) {
    return ghost.ok ? (ghost.near === false ? GHOST_WALK : GHOST_OK) : GHOST_BAD;
}

/*
 * One ghost, on `seat`: the height and whether the tile is water, from
 * `place(x, y)`, the same way placed structures are seated
 * (AsciiWorld.syncStructures). Over water the piece stands on a deck at
 * `deck` above y = 0 (the sea level) instead of on the ground `height`.
 */
function makeGhost(ghost, seat, materials) {
    const { height, overWater, deck } = seat;
    const color = tint(ghost);
    if (!materials.has(color)) materials.set(color, ownMaterial(color, "solid", { unlit: true }));
    const mat = materials.get(color);
    const group = new THREE.Group();
    const model = buildStructure({ kind: ghost.kind, open: ghost.kind === "door", facing: ghost.facing }, { lit: false, overWater, deck });
    if (model) {
        model.traverse((node) => {
            if (!node.isMesh) return;
            /* One flat colour for every part, and no shadow: a ghost must
               not darken the ground it is previewing. */
            node.material = mat;
            node.castShadow = false;
        });
        /* `facing` is in quarter turns. */
        if (ghost.facing) model.rotation.y = (ghost.facing * Math.PI) / 2;
        group.add(model);
    }
    const plate = new THREE.Mesh(plateGeo, mat);
    plate.position.y = (overWater ? deck : 0) + 0.03;
    group.add(plate);
    group.position.set(ghost.x, overWater ? 0 : height, ghost.y);
    return group;
}

/* The set of ghosts in the scene. Add once per scene; dispose() on teardown. */
export class Ghosts {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = "ghosts";
        scene.add(this.group);
        this.signature = "";
        this.materials = new Map();
    }

    /* Replace what is shown with `list` (or nothing for null). `place(x, y)`
       gives { height, overWater, deck } for a tile. Rebuilds only when the
       signature below changes, so calling this every render is cheap. */
    set(list, place) {
        /* The seat is part of what is drawn: somebody else digging or
           piling the tile moves the ghost with the ground. */
        const seats = (list || []).map((g) => place(g.x, g.y));
        const signature = (list || [])
            .map((g, i) => `${g.x},${g.y},${g.kind},${g.facing},${tint(g)},${seats[i].height},${seats[i].overWater},${seats[i].deck}`)
            .join(";");
        if (signature === this.signature) return;
        this.signature = signature;
        this.group.clear();
        (list || []).forEach((g, i) => this.group.add(makeGhost(g, seats[i], this.materials)));
    }

    /* A slow breath, so a ghost never passes for the real thing: scale
       swings 0.91 to 0.97 about 0.94 (sin at 5 rad/s, `time` in seconds),
       held at 1 for reduced motion. Called every frame. */
    update(time, reducedMotion) {
        const s = reducedMotion ? 1 : 0.94 + Math.sin(time * 5) * 0.03;
        this.group.children.forEach((g) => g.scale.set(s, s, s));
    }

    dispose() {
        this.group.clear();
        this.scene.remove(this.group);
        this.materials.forEach((m) => m.dispose());
        this.materials.clear();
    }
}

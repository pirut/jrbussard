import * as THREE from "three";
import { buildStructure } from "./models";
import { ownMaterial } from "./materials";

/*
 * The build ghost: the piece you are about to place, standing on the tile
 * it would go on, in green where it will go up and red where it won't. A
 * drag shows a whole run of them. Drawn unlit, so it reads the same by day
 * or night, and in the ASCII pass as a flat block of one colour that stands
 * apart from the lit, textured world around it.
 */

export const GHOST_OK = "#8fe39a";
export const GHOST_WALK = "#d9dd8a";
export const GHOST_BAD = "#ef7a62";

const plateGeo = new THREE.BoxGeometry(0.96, 0.05, 0.96);

function tint(ghost) {
    return ghost.ok ? (ghost.near === false ? GHOST_WALK : GHOST_OK) : GHOST_BAD;
}

/*
 * One ghost. `place(x, y)` gives the height and whether the tile is water,
 * the same way placed structures are seated (AsciiWorld.syncStructures).
 */
function makeGhost(ghost, place, materials) {
    const { height, overWater, deck } = place(ghost.x, ghost.y);
    const color = tint(ghost);
    if (!materials.has(color)) materials.set(color, ownMaterial(color, "solid", { unlit: true }));
    const mat = materials.get(color);
    const group = new THREE.Group();
    const model = buildStructure({ kind: ghost.kind, open: ghost.kind === "door", facing: ghost.facing }, { lit: false, overWater, deck });
    if (model) {
        model.traverse((node) => {
            if (!node.isMesh) return;
            node.material = mat;
            node.castShadow = false;
        });
        if (ghost.facing) model.rotation.y = (ghost.facing * Math.PI) / 2;
        group.add(model);
    }
    const plate = new THREE.Mesh(plateGeo, mat);
    plate.position.y = (overWater ? deck : 0) + 0.03;
    group.add(plate);
    group.position.set(ghost.x, overWater ? 0 : height, ghost.y);
    return group;
}

export class Ghosts {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.name = "ghosts";
        scene.add(this.group);
        this.signature = "";
        this.materials = new Map();
    }

    set(list, place) {
        const signature = (list || []).map((g) => `${g.x},${g.y},${g.kind},${g.facing},${tint(g)}`).join(";");
        if (signature === this.signature) return;
        this.signature = signature;
        this.group.clear();
        (list || []).forEach((g) => this.group.add(makeGhost(g, place, this.materials)));
    }

    /* A slow breath, so a ghost never passes for the real thing. */
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

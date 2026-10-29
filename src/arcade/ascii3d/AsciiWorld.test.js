import * as THREE from "three";
import AsciiWorld from "./AsciiWorld";
import { GroundMap, baseHeight, TERRACE } from "../../lib/ground";
import { tileAt, CHUNK, GRASS } from "../../lib/terrain";

/* The geometry merge comes from three's ES-module addons, which Jest does
   not load; walking does not need it. */
jest.mock("./mergeModel", () => ({ mergeModel: (model) => model, disposeMerged: () => {} }));

/*
 * Walking, without a renderer: the real movement code run against a world
 * that only knows the ground. A figure keeps to the ground it is crossing,
 * dug or not, however its steps overlap.
 */

function stage(ground) {
    const proto = AsciiWorld.prototype;
    const world = { time: 0, ground, structures: new Map() };
    ["bridged", "entityHeight", "moveEntity", "makeEntity", "updateEntity", "finishEntity"].forEach((name) => {
        world[name] = proto[name].bind(world);
    });
    world.scene = new THREE.Scene();
    return world;
}

/* Three high grass tiles in a row, so a pit two steps deep stays dry. */
function row() {
    for (let y = 20; y < 400; y += 1)
        for (let x = 20; x < 400; x += 1)
            if ([0, 1, 2].every((i) => tileAt(x + i, y) === GRASS && baseHeight(x + i, y) >= 5 * TERRACE)) return { x, y };
    throw new Error("no such row");
}

describe("walking through dug ground", () => {
    it.each([false, true])("stays in the pit when a step starts mid-stride (glide %s)", (glide) => {
        const at = row();
        const ground = new GroundMap();
        const edits = [0, 1, 2].map((i) => ({ x: at.x + i, y: at.y, edit: -2 }));
        const key = `${Math.floor(at.x / CHUNK)}:${Math.floor(at.y / CHUNK)}`;
        ground.absorb({ ground: edits, groundChunks: [key] });
        const world = stage(ground);
        const floor = world.entityHeight(at.x, at.y);
        expect(floor).toBeCloseTo(baseHeight(at.x, at.y) - 2 * TERRACE);

        const entity = world.makeEntity(new THREE.Group(), at.x, at.y);
        entity.glide = glide;
        world.time = 1;
        world.moveEntity(entity, at.x + 1, at.y, 0.3);
        world.time += 0.15;
        world.updateEntity(entity, 0.15);
        const before = entity.pos.y;

        /* The next step arrives while the first is half done. */
        world.moveEntity(entity, at.x + 2, at.y, 0.3);
        world.updateEntity(entity, 0);
        expect(entity.pos.y).toBeCloseTo(before, 5);

        /* And it ends on the pit floor. */
        world.time += 1;
        for (let i = 0; i < 30; i += 1) world.updateEntity(entity, 0.1);
        expect(entity.pos.y).toBeCloseTo(world.entityHeight(at.x + 2, at.y), 5);
    });
});

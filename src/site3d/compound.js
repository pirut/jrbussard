import * as THREE from "three";
import {
    BRICK,
    GOLD,
    STONE_TRIM,
    VERDIGRIS,
    basil,
    chimney,
    church,
    kremlinTower,
    observatoryDome,
    slab,
    stalinTower,
    wallTile,
} from "../arcade/ascii3d/architecture";
import { P, place } from "../arcade/ascii3d/shapes";

/*
 * Each room of the workshop as a walled compound: Kremlin brick all round,
 * towers at the corners, a gate tower over every door, and behind the far
 * wall the building the room is named for.
 *
 * The camera looks north, so the walls climb from front to back: a low
 * parapet along the south side to see in over, taller walls down the sides,
 * the tallest along the north, and the landmark above that. Everything
 * stands on the wall tiles the tile world already has, so walking and
 * collisions are unchanged; only the landmarks stand outside, across the
 * street, on lots the compound keeps clear of tenements.
 *
 * Purely visual and client-only: nothing here is read by the server, by
 * world/build.js or by walking. It is called once per room from
 * SiteScene.buildCompounds (geometry) and once from SiteScene.init
 * (reservedTiles), and the two must agree, see below. It draws into a
 * Batch (arcade/ascii3d/terrainMesh.js), which collects triangles per
 * material and hands back one merged mesh each, so every tower and wall tile
 * costs vertices rather than draw calls; that is why nothing here creates a
 * Mesh itself.
 *
 * Invariants: no Math.random or clock; any variation is a hash of tile
 * position, so every visitor sees the same walls. The shapes assume the
 * fixed isometric view of SiteScene (a camera off the south-east corner,
 * see ascii3d/iso.js): walls get taller away from the camera
 * so the interior stays visible, and the wall-cutaway in iso.js trims
 * whatever still stands between the camera and JR. Landmark builders take
 * (batch, x, z, groundY), in that order, like architecture.js.
 */

/* Wall heights in tiles: the back (north) wall, the side walls, and the
   low front (south) parapet you look over. Diorama's arcade hall reuses the
   north height (3.4) for its back wall. */
const NORTH = 3.4;
const SIDE = 2.4;
const SOUTH = 0.9;

/* The room's brick, nudged 16% toward the room's tint (an RGB 0-255 triple
   from rooms.js), so each compound is the same Kremlin red with a hint of
   its room's mood. Returns a CSS hex string. */
function roomBrick(room) {
    const tint = new THREE.Color(room.tint[0] / 255, room.tint[1] / 255, room.tint[2] / 255);
    return `#${new THREE.Color(BRICK).lerp(tint, 0.16).getHexString()}`;
}

/* Runs of open tiles along one side: the doors. `tiles` is the side's
   interior tiles in order (corners excluded); `open(x, y)` is true where
   there is no wall. Returns each run's centre ({x, y}, possibly a half
   tile) and its length n in tiles. */
function gaps(tiles, open) {
    const runs = [];
    let run = null;
    tiles.forEach((t) => {
        if (open(t.x, t.y)) {
            if (!run) runs.push((run = []));
            run.push(t);
        } else run = null;
    });
    return runs.map((r) => ({ x: (r[0].x + r[r.length - 1].x) / 2, y: (r[0].y + r[r.length - 1].y) / 2, n: r.length }));
}

/* The landmark behind each room, keyed by room id (world/rooms.js), as
   [offset along the north wall, builder]. The offset is a fraction 0-1 of
   the wall's width; the builder is called as (batch, x, z, groundY) with x
   the rounded position along the wall and z BACK tiles north of it. The
   small z nudges (-0.4, -0.6 ...) and the scales are authored values that
   place each landmark relative to BACK; there is no formula behind them.
   A room id missing from here simply has no landmark. */
const LANDMARKS = {
    observatory: [
        [0.5, (b, x, z, y) => observatoryDome(b, x, z - 0.4, y, { scale: 1.2 })],
        [0.22, (b, x, z, y) => stalinTower(b, x, z, y, { scale: 0.55, crown: "star", tiers: 4 })],
        [0.78, (b, x, z, y) => stalinTower(b, x, z, y, { scale: 0.55, crown: "star", tiers: 4 })],
    ],
    library: [[0.5, (b, x, z, y) => church(b, x, z - 0.6, y, { scale: 1.15, belfry: 1 })]],
    atrium: [
        [0.76, (b, x, z, y) => stalinTower(b, x, z - 0.6, y, { scale: 1.05, crown: "cross", wings: true })],
        [0.26, (b, x, z, y) => church(b, x, z - 0.4, y, { scale: 0.95, dome: "#3f6fb0", small: GOLD, belfry: -1 })],
    ],
    foundry: [
        [0.2, (b, x, z, y) => chimney(b, x, z, y, 11, 0.6)],
        [0.3, (b, x, z, y) => chimney(b, x, z, y, 13, 0.65)],
        [0.4, (b, x, z, y) => chimney(b, x, z, y, 9.5, 0.55)],
        [0.66, (b, x, z, y) => slab(b, x, z - 0.6, y, 9, 3, 6.5)],
        [0.86, (b, x, z, y) => kremlinTower(b, x, z, y, { w: 2.2, h: 6, crown: "star" })],
    ],
    arcade: [[0.74, (b, x, z, y) => basil(b, x, z - 0.4, y, { scale: 1.25 })]],
    beacon: [[0.26, (b, x, z, y) => church(b, x, z - 0.2, y, { scale: 0.7, domes: 1, dome: "#4f9a6a", belfry: 0 })]],
};

/* Tiles a landmark needs kept clear, by its centre. */
const CLEAR = { w: 6, d: 6 };
/* Landmarks stand back from the wall, past the street that runs round it. */
const BACK = 4.6;

/*
 * The set of "x,y" tile keys north of each room that must stay free of
 * tenements because a landmark stands there. SiteScene.buildChunk skips
 * these tiles, and cityAt does not treat a lot that touches one as a
 * candidate for an oddity. It must be derived from the same LANDMARKS,
 * the same centre formula and the same BACK as buildCompound, or a tenement
 * grows through a church: change one, change the other. The band runs from
 * two tiles north of the room's top wall row for CLEAR.d tiles further
 * north, CLEAR.w + 1 tiles wide (the x loop is inclusive) around each
 * landmark's centre. `rooms` is world.rooms; the result only depends on it,
 * so it is deterministic.
 */
export function reservedTiles(rooms) {
    const keep = new Set();
    rooms.forEach((room) => {
        (LANDMARKS[room.id] || []).forEach(([f]) => {
            const cx = Math.round(room.x + (room.w - 1) * f);
            for (let y = room.y - 2 - CLEAR.d; y < room.y - 2; y += 1) {
                for (let x = cx - CLEAR.w / 2; x <= cx + CLEAR.w / 2; x += 1) keep.add(`${x},${y}`);
            }
        });
    });
    return keep;
}

/*
 * Build one room's compound into the batch. `open(x, y)` says whether a
 * border tile is a door; `floor` is the height the room stands at. The
 * border tiles are the room's own wall ring from world/build.js; each
 * non-door tile gets a wallTile, and any run of door tiles gets a gate
 * tower (north, west, east) or two low posts (south) in its place.
 */
export function buildCompound(b, room, open, floor) {
    const brick = roomBrick(room);
    const x0 = room.x;
    const y0 = room.y;
    const x1 = room.x + room.w - 1;
    const y1 = room.y + room.h - 1;
    const range = (a, z) => Array.from({ length: z - a + 1 }, (_, i) => a + i);
    const north = range(x0 + 1, x1 - 1).map((x) => ({ x, y: y0 }));
    const south = range(x0 + 1, x1 - 1).map((x) => ({ x, y: y1 }));
    const west = range(y0 + 1, y1 - 1).map((y) => ({ x: x0, y }));
    const east = range(y0 + 1, y1 - 1).map((y) => ({ x: x1, y }));
    const doors = {
        north: gaps(north, open),
        south: gaps(south, open),
        west: gaps(west, open),
        east: gaps(east, open),
    };
    /* Tiles under a gate tower are built by the tower, not the wall. The
       radius is the opening's half-width plus 1.2, a little wider than the
       tower's own half-width (n/2 + 0.7 to 0.8), so no wall tile pokes out
       beside its piers. */
    const underGate = (side, t) => doors[side].some((g) => Math.hypot(g.x - t.x, g.y - t.y) <= g.n / 2 + 1.2);

    north.forEach((t) => !open(t.x, t.y) && !underGate("north", t) && wallTile(b, t.x, t.y, floor, NORTH, true, brick));
    south.forEach((t) => !open(t.x, t.y) && wallTile(b, t.x, t.y, floor, SOUTH, true, brick));
    west.forEach((t) => !open(t.x, t.y) && !underGate("west", t) && wallTile(b, t.x, t.y, floor, SIDE, false, brick));
    east.forEach((t) => !open(t.x, t.y) && !underGate("east", t) && wallTile(b, t.x, t.y, floor, SIDE, false, brick));

    /* Corner towers: tall at the back, squat turrets at the front. */
    kremlinTower(b, x0, y0, floor, { w: 2.4, h: 6.4, crown: "star", brick });
    kremlinTower(b, x1, y0, floor, { w: 2.4, h: 6.4, crown: "cross", brick });
    kremlinTower(b, x0, y1, floor, { w: 1.7, h: 1.8, crown: "cross", brick, roof: GOLD });
    kremlinTower(b, x1, y1, floor, { w: 1.7, h: 1.8, crown: "cross", brick, roof: GOLD });

    /* Gate towers over the doors at the back and sides. */
    doors.north.forEach((g) => kremlinTower(b, g.x, g.y, floor, { w: g.n + 1.6, h: 6.2, gate: g.n, crown: "star", brick }));
    doors.west.forEach((g) => kremlinTower(b, g.x, g.y, floor, { w: g.n + 1.4, h: 5, gate: g.n, axis: "z", crown: "cross", brick }));
    doors.east.forEach((g) => kremlinTower(b, g.x, g.y, floor, { w: g.n + 1.4, h: 5, gate: g.n, axis: "z", crown: "cross", brick }));
    /* At the front, only posts, so the gate does not hide the room. */
    doors.south.forEach((g) =>
        [-1, 1].forEach((s) => {
            const px = g.x + s * (g.n / 2 + 0.5);
            b.shape("rock", P.cube(), place(px, floor + 0.9, g.y, 0.7, 1.8, 0.7), new THREE.Color(brick));
            b.shape("solid", P.spire(), place(px, floor + 1.8, g.y, 0.5, 1.4, 0.5), new THREE.Color(VERDIGRIS));
        }),
    );

    /* Towers part-way along long walls, to break the run: one mid-way on each
       side wall of a room 17 or more tall, and one every 12 tiles along the
       north wall (starting 12 in from the west edge, stopping 6 short of the
       east corner). Skipped within 3 tiles of a door so they never crowd a
       gate. */
    const tooClose = (side, t) => doors[side].some((g) => Math.hypot(g.x - t.x, g.y - t.y) < g.n / 2 + 3);
    if (room.h >= 17) {
        const my = Math.round(y0 + room.h / 2);
        [
            ["west", x0],
            ["east", x1],
        ].forEach(([side, x]) => !tooClose(side, { x, y: my }) && kremlinTower(b, x, my, floor, { w: 1.9, h: 4, crown: "cross", brick }));
    }
    for (let x = x0 + 12; x < x1 - 6; x += 12) {
        if (!tooClose("north", { x, y: y0 })) kremlinTower(b, x, y0, floor, { w: 1.9, h: 4.8, crown: "star", brick });
    }

    /* White stone band along the north wall's foot, to seat it. */
    b.shape("solid", P.cube(), place((x0 + x1) / 2, floor + 0.12, y0 + 0.36, room.w - 2, 0.24, 0.06), new THREE.Color(STONE_TRIM));

    /* And the landmark behind it all. */
    (LANDMARKS[room.id] || []).forEach(([f, build]) => {
        const cx = Math.round(x0 + (room.w - 1) * f);
        build(b, cx, y0 - BACK, floor);
    });
}

import { cellMarkup } from "../lib/glyph";
import { shadeAt, GRAIN_SPREAD } from "../lib/shade";
import { buildPlane, NEAR, FAR } from "./parallax";
import {
    KIND,
    PALETTE,
    ANIMATED,
    ANIM_FRAMES,
    INTERACTIVE,
} from "./tiles";

const PLAYER_LIGHT = 0.78;
const PLAYER_RADIUS = 16;
const TORCH_RADIUS = 8;
const LEVELS = 12;
const UNLIT = [72, 84, 108];
/*
 * How dark a cell can actually get. Letting distance carry cells most of the
 * way to the background is what gives the world depth.
 */
const FLOOR_LIGHT = 0.05;
const CEIL_LIGHT = 0.95;
/* Rows are rebuilt at most this often for animation alone (water, torches,
   the pulse on props); a camera or player move rebuilds them at once, in
   the same frame as the slide. */
const FRAME_MS = 80;

/*
 * Torches do not only brighten what is near them, they warm it. Cells inside
 * a torch's reach are pulled toward this colour in proportion to how much of
 * its light they get, so a hearth reads as firelight rather than a spotlight.
 */
const TORCH_TINT = [255, 176, 84];
const TORCH_TINT_STRENGTH = 0.55;
const TINT_STEPS = 4;

/* The light you carry is a lantern: what is near you is warm, what is far
   is cool. Warm near, cool far is the oldest depth cue there is. */
const LANTERN_TINT = [255, 216, 168];
const LANTERN_STRENGTH = 0.3;
const LANTERN_STEPS = 3;

/* Anything with height casts a little shade to its lower right. */
const SHADOW_DEPTH = 0.1;

/*
 * Height. The camera sits above the player looking straight down, so the top
 * of anything tall is displaced away from the player in proportion to its
 * height and its distance from the centre: a wall right beside you shows
 * only its top, a wall at the edge of the screen leans outward and shows
 * its face. Walking moves the vanishing point, and the whole picture tilts
 * with you. `h` is the displacement per cell of distance.
 */
const TALL = {
    [KIND.WALL]: { h: 0.14, side: "▒", topLift: 2 },
    [KIND.TREE]: { h: 0.1, side: "▒", topLift: 2 },
    [KIND.MOUNTAIN]: { h: 0.2, side: "▲", topLift: 2 },
};
/* Faces are in shadow: a fixed dark band, whatever the light on the top. */
const FACE_LEVEL_MAX = 3;
const FACE_LEVEL_DROP = 5;

/*
 * Terrain and structure get per-cell grain. Interactive props deliberately do
 * not — a book or a torch should read at its own colour so the eye can pick
 * it out of the texture.
 */
const GRAINED = new Set([
    KIND.GRASS,
    KIND.TREE,
    KIND.MOUNTAIN,
    KIND.WATER,
    KIND.FLOOR,
    KIND.WALL,
    KIND.STAR,
]);

/*
 * Distance does not fade things to black, it fades them to haze. Cells far
 * from any light settle toward this cool blue rather than the page
 * background, which is what makes the far field read as air.
 */
const HAZE = [9, 14, 27];

function hex(rgb, t) {
    const bg = HAZE;
    const mix = (a, b) => Math.round(b + (a - b) * t);
    const value =
        (mix(rgb[0], bg[0]) << 16) | (mix(rgb[1], bg[1]) << 8) | mix(rgb[2], bg[2]);
    return `#${value.toString(16).padStart(6, "0")}`;
}

function mixRgb(a, b, t) {
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
    ];
}

function clampLevel(level) {
    return level < 0 ? 0 : level > LEVELS - 1 ? LEVELS - 1 : level;
}

/* Colour lookups are pure functions of (kind, tint, brightness level), so
   memoising them keeps the per-frame work down to string building. */
function makeColorCache() {
    const cache = new Map();
    return (rgb, level, salt) => {
        const key = `${salt}:${level}`;
        let value = cache.get(key);
        if (value === undefined) {
            value = hex(
                rgb,
                FLOOR_LIGHT + (level / (LEVELS - 1)) * (CEIL_LIGHT - FLOOR_LIGHT)
            );
            cache.set(key, value);
        }
        return value;
    };
}

/* Torch glow never moves, so bake it into the world once. */
function bakeTorchLight(world) {
    const light = new Float32Array(world.w * world.h);
    world.torches.forEach((torch) => {
        for (let dy = -TORCH_RADIUS; dy <= TORCH_RADIUS; dy += 1) {
            for (let dx = -TORCH_RADIUS; dx <= TORCH_RADIUS; dx += 1) {
                const x = torch.x + dx;
                const y = torch.y + dy;
                if (x < 0 || y < 0 || x >= world.w || y >= world.h) continue;
                const d = Math.hypot(dx, dy);
                if (d > TORCH_RADIUS) continue;
                const i = y * world.w + x;
                light[i] = Math.max(light[i], 0.5 * (1 - d / TORCH_RADIUS));
            }
        }
    });
    return light;
}

/* Ground to the lower right of something tall sits in its shade. */
function bakeShadow(world) {
    const shadow = new Uint8Array(world.w * world.h);
    const tall = (x, y) =>
        x >= 0 && y >= 0 && x < world.w && y < world.h && TALL[world.kinds[y * world.w + x]];
    for (let y = 0; y < world.h; y += 1) {
        for (let x = 0; x < world.w; x += 1) {
            const i = y * world.w + x;
            if (TALL[world.kinds[i]]) continue;
            if (tall(x - 1, y - 1) || tall(x, y - 1) || tall(x - 1, y)) shadow[i] = 1;
        }
    }
    return shadow;
}

/* Floors and walls take on their room's colour; props keep their own so they
   stay recognisable from room to room. */
const TINTABLE = [KIND.FLOOR, KIND.WALL];
const TINT_STRENGTH = { [KIND.FLOOR]: 0.34, [KIND.WALL]: 0.46 };

function bakeZoneColors(world) {
    return world.zoneTints.map((tint) => {
        const byKind = {};
        TINTABLE.forEach((kind) => {
            const base = PALETTE[kind];
            byKind[kind] = tint ? mixRgb(base, tint, TINT_STRENGTH[kind]) : base;
        });
        return byKind;
    });
}

/* Canopy for the near plane — dark, but green enough to read as trees
   passing in front of you — and haze for the far one. */
const NEAR_COLORS = ["#0f2a1b", "#0c2116", "#123322", "#0a1a12"];
const FAR_COLORS = ["#141b28", "#111826", "#172032"];

/* Rows of a layer, given their new HTML: only touch the ones that changed. */
function commitRows(layer, built) {
    for (let i = 0; i < built.length; i += 1) {
        if (layer.cache[i] === built[i]) continue;
        layer.rows[i].innerHTML = built[i];
        layer.cache[i] = built[i];
    }
}

function makeRows(node, count) {
    node.textContent = "";
    const rows = [];
    for (let i = 0; i < count; i += 1) {
        const row = document.createElement("div");
        row.className = "world__row";
        node.appendChild(row);
        rows.push(row);
    }
    return rows;
}

/* Only touch the DOM when a layer has actually moved. Offsets are snapped
   to device pixels so text never lands between them and shimmers. */
function place(node, x, y, dpr) {
    const sx = Math.round(x * dpr) / dpr;
    const sy = Math.round(y * dpr) / dpr;
    const value = `translate3d(${sx.toFixed(2)}px, ${sy.toFixed(2)}px, 0)`;
    if (node.__placed === value) return;
    node.__placed = value;
    node.style.transform = value;
}

export function createRenderer(container, world, planes = {}) {
    const torchLight = bakeTorchLight(world);
    const shadow = bakeShadow(world);
    const zoneColors = bakeZoneColors(world);
    const colorOf = makeColorCache();

    const stage = { node: container, rows: [], cache: [] };
    /* Each parallax plane keeps its own rows, its own diff cache, and its
       own integer origin, since each slides at its own rate. */
    const layers = ["near", "far"]
        .filter((name) => planes[name])
        .map((name) => ({
            name,
            node: planes[name],
            plane: name === "near" ? NEAR : FAR,
            colors: name === "near" ? NEAR_COLORS : FAR_COLORS,
            rows: [],
            cache: [],
            originX: NaN,
            originY: NaN,
        }));

    let cols = 0;
    let last = { camX: NaN, camY: NaN, px: NaN, py: NaN, signature: "", counts: null, time: -Infinity };

    function setSize(nextCols, rowCount) {
        /* ResizeObserver fires for sub-pixel changes too; rebuilding the rows
           would blank the screen for a frame, so only do it when it matters. */
        if (stage.rows.length === rowCount && cols === nextCols) return;
        cols = nextCols;
        [stage, ...layers].forEach((layer) => {
            layer.rows = makeRows(layer.node, rowCount);
            layer.cache = new Array(rowCount).fill(null);
        });
        layers.forEach((layer) => {
            layer.originX = NaN;
            layer.originY = NaN;
        });
        last = { ...last, camX: NaN, camY: NaN };
    }

    const inside = (wx, wy) => wx >= 0 && wy >= 0 && wx < world.w && wy < world.h;

    /* A prop whose slot has no content behind it — an empty shelf, a cabinet
       with nothing plugged in — is drawn cold and does not pulse. */
    function isUnlit(index, counts) {
        const marker = world.markerLookup.get(index);
        if (!marker) return false;
        const limit = counts[marker.kind];
        return limit !== undefined && marker.index >= limit;
    }

    /* How lit a cell is, before grain: ambient, your own light, torches. */
    function lightAt(wx, wy, i, zone, player, flicker) {
        let light = world.zoneAmbient[zone];
        const d = Math.hypot(wx - player.x, wy - player.y);
        if (d < PLAYER_RADIUS) {
            /* Squared falloff rather than linear: a bright pool around you
               that drops away fast, instead of an even wash. */
            const t = 1 - d / PLAYER_RADIUS;
            light += PLAYER_LIGHT * t * t;
        }
        light += torchLight[i] * flicker;
        if (shadow[i]) light -= SHADOW_DEPTH;
        return light;
    }

    /*
     * Foliage on the near plane passes in front of the world, but never in
     * front of a room, a label, or anything you can use — depth is not worth
     * having if it hides what you came to read.
     */
    function makeBlocked(camX, camY) {
        return (x, y) => {
            const wx = camX + x;
            const wy = camY + y;
            if (!inside(wx, wy)) return false;
            const i = wy * world.w + wx;
            const kind = world.kinds[i];
            return world.zones[i] !== 0 || kind === KIND.LABEL || Boolean(INTERACTIVE[kind]);
        };
    }

    function drawPlane(layer, originX, originY, blocked) {
        commitRows(
            layer,
            buildPlane({
                cols,
                rows: layer.rows.length,
                originX,
                originY,
                plane: layer.plane,
                colors: layer.colors,
                blocked: layer.plane.clearRadius > 0 ? blocked : null,
            })
        );
    }

    function drawStage(camX, camY, player, time, counts) {
        const flicker = 0.82 + 0.18 * Math.sin(time * 0.009);
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.004);
        const frame = Math.floor(time / 190);
        const built = [];
        /* Tops and faces of tall things, composed over the ground here so
           they cost no layer of their own. */
        const relief = buildRelief(camX, camY, player, flicker);

        for (let ry = 0; ry < stage.rows.length; ry += 1) {
            const wy = camY + ry;
            let html = "";
            let runColor = null;
            let runText = "";

            for (let rx = 0; rx < cols; rx += 1) {
                const wx = camX + rx;
                let color;
                let ch;

                const lifted = relief.chars[ry * cols + rx];
                if (lifted !== null) {
                    ch = lifted;
                    color = relief.colors[ry * cols + rx];
                } else if (!inside(wx, wy)) {
                    ch = " ";
                    color = colorOf(PALETTE[KIND.VOID], 0, "v");
                } else {
                    const i = wy * world.w + wx;
                    const kind = world.kinds[i];
                    const zone = world.zones[i];
                    const torch = torchLight[i];
                    ch = ANIMATED.has(kind)
                        ? ANIM_FRAMES[kind][(frame + wx * 3 + wy * 5) & 3]
                        : world.chars[i];
                    const unlit = INTERACTIVE[kind] ? isUnlit(i, counts) : false;
                    let rgb = unlit ? UNLIT : zoneColors[zone][kind] || PALETTE[kind];

                    /* The player is its own sprite so it can glide; the cell
                       underneath just gets lit up. */
                    const isPlayer = wx === player.x && wy === player.y;
                    let light = lightAt(wx, wy, i, zone, player, flicker);
                    let tintStep = 0;
                    let warmStep = 0;
                    const tintable = !unlit && kind !== KIND.TORCH && !INTERACTIVE[kind] && kind !== KIND.LABEL;
                    if (torch > 0 && tintable) {
                        /* Warm what the fire reaches. Quantised so the colour
                           cache stays small and runs stay long. */
                        tintStep = Math.min(TINT_STEPS, Math.round(torch * flicker * 2 * TINT_STEPS));
                    }
                    if (tintable && !isPlayer) {
                        const d = Math.hypot(wx - player.x, wy - player.y);
                        if (d < PLAYER_RADIUS) {
                            const t = 1 - d / PLAYER_RADIUS;
                            warmStep = Math.round(t * t * LANTERN_STEPS);
                        }
                    }
                    if (kind === KIND.TORCH) light += 0.3 * flicker;
                    if (INTERACTIVE[kind] && !unlit) light += 0.12 + 0.2 * pulse;
                    if (isPlayer) light = 1;

                    /* Grain: neighbouring cells of one kind sit a notch apart
                       in brightness, so a field reads as texture instead of a
                       repeated glyph. Applied to the light level rather than
                       in colour space so long runs still collapse into one
                       span. */
                    if (!unlit && GRAINED.has(kind)) light += GRAIN_SPREAD[shadeAt(wx, wy)];

                    const level = clampLevel(Math.round(light * (LEVELS - 1)));
                    if (warmStep) {
                        rgb = mixRgb(rgb, LANTERN_TINT, (warmStep / LANTERN_STEPS) * LANTERN_STRENGTH);
                    }
                    if (tintStep) {
                        rgb = mixRgb(rgb, TORCH_TINT, (tintStep / TINT_STEPS) * TORCH_TINT_STRENGTH);
                    }
                    const salt = unlit ? "u" : `${kind}:${zone}:${tintStep}:${warmStep}`;
                    color = colorOf(rgb, level, salt);
                }

                if (color !== runColor) {
                    if (runColor !== null) html += `<span style="color:${runColor}">${runText}</span>`;
                    runColor = color;
                    runText = "";
                }
                runText += cellMarkup(ch);
            }

            if (runColor !== null) html += `<span style="color:${runColor}">${runText}</span>`;
            built.push(html);
        }
        commitRows(stage, built);
    }

    /*
     * Relief: tops and faces of walls, trees and mountains, projected away
     * from the player into a screen grid. Tops win over faces; nothing is
     * ever drawn over a label, a prop, or the cells around you.
     */
    function buildRelief(camX, camY, player, flicker) {
        const rowCount = stage.rows.length;
        const chars = new Array(cols * rowCount).fill(null);
        const colors = new Array(cols * rowCount);
        const tops = new Uint8Array(cols * rowCount);
        const cx = player.x - camX;
        const cy = player.y - camY;

        const precious = (wx, wy) => {
            if (!inside(wx, wy)) return false;
            const kind = world.kinds[wy * world.w + wx];
            return kind === KIND.LABEL || Boolean(INTERACTIVE[kind]);
        };
        /* Never over a label (or the gap between two of its words), a prop,
           the cells around you — or anything that is itself tall. A face
           projected at a shallow angle would otherwise land on the next
           cell of the same wall and punch a dark hole in it. */
        const clear = (px, py) => {
            if (Math.abs(px - cx) <= 1 && Math.abs(py - cy) <= 1) return false;
            const wx = camX + px;
            const wy = camY + py;
            if (inside(wx, wy) && TALL[world.kinds[wy * world.w + wx]]) return false;
            return !precious(wx, wy) && !precious(wx - 1, wy) && !precious(wx + 1, wy);
        };

        for (let y = 0; y < rowCount; y += 1) {
            const wy = camY + y;
            for (let x = 0; x < cols; x += 1) {
                const wx = camX + x;
                if (!inside(wx, wy)) continue;
                const i = wy * world.w + wx;
                const kind = world.kinds[i];
                const spec = TALL[kind];
                if (!spec) continue;
                /* Only a room's outer walls have height. Furniture — the
                   pedestal, the pool, the cabinets — stays flat, or the
                   room fills with floating blocks that follow you. */
                const zone = world.zones[i];
                if (kind === KIND.WALL && zone > 0) {
                    const room = world.rooms[zone - 1];
                    const onEdge =
                        wx === room.x ||
                        wy === room.y ||
                        wx === room.x + room.w - 1 ||
                        wy === room.y + room.h - 1;
                    if (!onEdge) continue;
                }

                const dx = (x - cx) * spec.h;
                const dy = (y - cy) * spec.h;
                const steps = Math.round(Math.max(Math.abs(dx), Math.abs(dy)));
                if (steps < 1) continue;

                const base = zoneColors[zone][kind] || PALETTE[kind];
                const light = lightAt(wx, wy, i, zone, player, flicker) + GRAIN_SPREAD[shadeAt(wx, wy)];
                const level = clampLevel(Math.round(light * (LEVELS - 1)));
                const faceLevel = clampLevel(Math.min(FACE_LEVEL_MAX, level - FACE_LEVEL_DROP));

                for (let s = 1; s <= steps; s += 1) {
                    const px = Math.round(x + (dx * s) / steps);
                    const py = Math.round(y + (dy * s) / steps);
                    if (px < 0 || py < 0 || px >= cols || py >= rowCount) continue;
                    if (px === x && py === y) continue;
                    if (!clear(px, py)) continue;
                    const top = s === steps;
                    const idx = py * cols + px;
                    if (tops[idx] && !top) continue;
                    tops[idx] = top ? 1 : 0;
                    chars[idx] = top ? world.chars[i] : spec.side;
                    colors[idx] = top
                        ? colorOf(base, clampLevel(level + spec.topLift), `t${kind}:${zone}`)
                        : colorOf(base, faceLevel, `f${kind}:${zone}`);
                }
            }
        }

        return { chars, colors };
    }

    /*
     * One call per animation frame. The camera is a floating point: rows are
     * drawn from its integer part and the fraction becomes a pixel translate.
     * Whenever the integer part changes, the rows and the translate are
     * updated together, in this same frame, so the picture never snaps a
     * cell and then catches up.
     */
    function frame({ cam, cell, player, time, counts, force = false }) {
        if (!cols) return;
        const dpr = window.devicePixelRatio || 1;
        const camX = Math.floor(cam.x);
        const camY = Math.floor(cam.y);
        const moved =
            force ||
            camX !== last.camX ||
            camY !== last.camY ||
            player.x !== last.px ||
            player.y !== last.py;

        layers.forEach((layer) => {
            const px = cam.x * layer.plane.factor;
            const py = cam.y * layer.plane.factor;
            const ox = Math.floor(px);
            const oy = Math.floor(py);
            const masked = layer.plane.clearRadius > 0;
            if (ox !== layer.originX || oy !== layer.originY || (masked && moved)) {
                layer.originX = ox;
                layer.originY = oy;
                drawPlane(layer, ox, oy, makeBlocked(camX, camY));
            }
            place(layer.node, -(px - ox) * cell.width, -(py - oy) * cell.height, dpr);
        });

        const flicker = 0.82 + 0.18 * Math.sin(time * 0.009);
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.004);
        /* Coarse on purpose: every change here rewrites the lit rows. */
        const signature = `${Math.floor(time / 190)},${Math.round(flicker * 8)},${Math.round(pulse * 6)}`;
        const animate =
            time - last.time >= FRAME_MS && (signature !== last.signature || counts !== last.counts);

        if (moved || animate) {
            drawStage(camX, camY, player, time, counts);
            last = { camX, camY, px: player.x, py: player.y, signature, counts, time };
        }

        place(stage.node, -(cam.x - camX) * cell.width, -(cam.y - camY) * cell.height, dpr);
    }

    return { setSize, frame };
}

/* Measures one character cell so the viewport can be sized in whole glyphs. */
export function measureCell(probe) {
    const rect = probe.getBoundingClientRect();
    return {
        width: rect.width / 40 || 8,
        height: rect.height || 16,
    };
}

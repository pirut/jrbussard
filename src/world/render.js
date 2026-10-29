/*
 * The character-grid renderer for the site overworld.
 *
 * Responsibility: paint a window of the built world (build.js) as rows of
 * coloured text, with lighting (ambient per room, a pool of light around the
 * player, baked torch glow), per-cell grain, animated glyphs and the two
 * parallax planes. It owns the row elements it creates and nothing else; it
 * does not decide what is solid, where the camera is, or what an interaction
 * does (pages/World.js does all of that and calls draw each frame).
 *
 * This is the fallback view: pages/World.js uses it only when the 3D scene
 * (site3d/) cannot start, e.g. no WebGL. Every effect here is cosmetic and
 * client-only; nothing the player sees through it is known to the server, and
 * no rule is read back from it.
 *
 * Performance shape, which the structure exists to protect: a frame builds an
 * HTML string per row, merging runs of equal colour into one span, and only
 * touches the DOM for rows whose string changed. Light is quantised into
 * LEVELS steps and colours are memoised per (kind, zone, level) for the same
 * reason: more distinct colours means more spans and more DOM writes.
 *
 * Invariant: what draw paints depends only on its arguments and the world
 * (no Math.random, no clock of its own), so the picture only changes when the
 * camera, the player, `counts` or `time` does. Pass a constant `time` to
 * freeze all animation (World.js does this for reduced motion).
 */
import { cellMarkup } from "../lib/glyph";
import { shadeAt, GRAIN_SPREAD } from "../lib/shade";
import { buildPlane, NEAR, FAR } from "./parallax";
import {
    KIND,
    PALETTE,
    PLAYER_COLOR,
    ANIMATED,
    ANIM_FRAMES,
    INTERACTIVE,
} from "./tiles";

/* Lighting, in the units the formulas below use: light is a brightness
   fraction, radii are in cells. PLAYER_LIGHT is the extra brightness added
   at the player's own cell, falling off to nothing at PLAYER_RADIUS; torches
   add up to 0.5 at their cell, falling to nothing at TORCH_RADIUS. All of
   these were tuned by eye. */
const PLAYER_LIGHT = 0.78;
const PLAYER_RADIUS = 16;
const TORCH_RADIUS = 8;
/* Brightness steps. Light is rounded to one of these before it becomes a
   colour, so neighbouring cells share colours and runs stay merged. */
const LEVELS = 12;
/* The cold, dull colour of a prop with nothing behind it (see isUnlit). */
const UNLIT = [72, 84, 108];
/*
 * How dark a cell can actually get. Previously the floor was 0.16, which kept
 * the far field plainly legible everywhere and flattened the picture — every
 * part of the screen sat at much the same brightness. Letting distance carry
 * cells most of the way to the background is what gives the world depth.
 */
const FLOOR_LIGHT = 0.14;
const CEIL_LIGHT = 0.95;

/*
 * Terrain and structure get per-cell grain. Interactive props deliberately do
 * not — a book or a torch should read at its own colour so the eye can pick
 * it out of the texture.
 */
const GRAINED = new Set([
    KIND.BLOCK,
    KIND.GRASS,
    KIND.TREE,
    KIND.MOUNTAIN,
    KIND.WATER,
    KIND.FLOOR,
    KIND.WALL,
    KIND.STAR,
]);

/* `rgb` blended toward the background by brightness `t` (1 = the colour
   itself, 0 = the background), as a #rrggbb string. */
function hex(rgb, t) {
    const bg = PALETTE.bg;
    const mix = (a, b) => Math.round(b + (a - b) * t);
    const value =
        (mix(rgb[0], bg[0]) << 16) | (mix(rgb[1], bg[1]) << 8) | mix(rgb[2], bg[2]);
    return `#${value.toString(16).padStart(6, "0")}`;
}

/* Colour lookups are pure functions of (kind, brightness level), so memoising
   them keeps the per-frame work down to string building. The returned
   function takes the base `rgb`, a brightness `level` (0..LEVELS-1) and a
   `salt` string naming where `rgb` came from; the cache key is only
   (salt, level), so a salt must always go with the same rgb (draw uses
   "kind:zone", "p" for the player and "u" for unlit props). The brightness
   range is squeezed into [FLOOR_LIGHT, CEIL_LIGHT] so nothing is ever pure
   background or fully blown out. */
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

/* Torch glow never moves, so bake it into the world once. Returns a
   Float32Array indexed like the world's grids with the brightest torch's
   contribution per cell (the maximum, not the sum, so a cluster of torches
   does not blow out). The flicker is applied later, per frame. */
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

/* Floors and walls take on their room's colour; props keep their own so they
   stay recognisable from room to room. */
const TINTABLE = [KIND.FLOOR, KIND.WALL];
/* How far, from 0 to 1, a tintable kind moves from its own colour toward the
   room's tint. Walls take more of it than floors so a room's edge reads. */
const TINT_STRENGTH = { [KIND.FLOOR]: 0.34, [KIND.WALL]: 0.46 };

/* One {kind: rgb} table per zone number (index 0 = outdoors, no tint), so
   draw does a single lookup per cell. */
function bakeZoneColors(world) {
    return world.zoneTints.map((tint) => {
        const byKind = {};
        TINTABLE.forEach((kind) => {
            const base = PALETTE[kind];
            if (!tint) {
                byKind[kind] = base;
                return;
            }
            const t = TINT_STRENGTH[kind];
            byKind[kind] = [
                Math.round(base[0] + (tint[0] - base[0]) * t),
                Math.round(base[1] + (tint[1] - base[1]) * t),
                Math.round(base[2] + (tint[2] - base[2]) * t),
            ];
        });
        return byKind;
    });
}

/* Silhouettes for the near plane, haze for the far one. Both are very dark
   greens so the planes read as shadow and mist rather than as more map; the
   near plane is darker. */
const NEAR_COLORS = ["#101a13", "#142018", "#0d160f"];
const FAR_COLORS = ["#1b2820", "#18251e", "#203026"];

/*
 * Make a renderer for one world.
 *
 * `container` is the element whose children become the world's rows (it is
 * emptied); `world` is a buildWorld() result; `planes` optionally holds
 * `near` and `far` elements for the parallax layers (either may be missing,
 * and then that layer is skipped). Returns:
 * - setSize(cols, rows): size the grid in character cells (see measureCell);
 *   returns {cols, rows} for the caller to keep.
 * - draw({cols, camX, camY, player, time, counts}): paint one frame. camX and
 *   camY are the world tile shown at the top-left cell (may be negative or
 *   past the edge, which draws void); `player` is the {x, y} tile; `time` is
 *   milliseconds from a steady clock; `counts` maps a prop kind to how many
 *   content items exist for it (props past that are drawn unlit).
 */
export function createRenderer(container, world, planes = {}) {
    const torchLight = bakeTorchLight(world);
    const zoneColors = bakeZoneColors(world);
    const colorOf = makeColorCache();
    let rows = [];
    let cache = [];
    let lastCols = 0;
    /* Each parallax plane keeps its own rows and its own diff cache. */
    const layers = ["near", "far"]
        .filter((name) => planes[name])
        .map((name) => ({
            name,
            node: planes[name],
            plane: name === "near" ? NEAR : FAR,
            colors: name === "near" ? NEAR_COLORS : FAR_COLORS,
            rows: [],
            cache: [],
        }));

    /* Rebuild the row elements for a new grid size. Rows are hidden from
       assistive tech: a screen of glyphs is noise, not content. */
    function setSize(cols, rowCount) {
        /* ResizeObserver fires for sub-pixel changes too; rebuilding the rows
           would blank the screen for a frame, so only do it when it matters. */
        if (rows.length === rowCount && lastCols === cols) {
            return { cols, rows: rowCount };
        }
        lastCols = cols;
        container.textContent = "";
        rows = [];
        cache = [];
        layers.forEach((layer) => {
            layer.node.textContent = "";
            layer.rows = [];
            layer.cache = [];
            for (let i = 0; i < rowCount; i += 1) {
                const row = document.createElement("div");
                row.className = "world__row";
                row.setAttribute("aria-hidden", "true");
                layer.node.appendChild(row);
                layer.rows.push(row);
                layer.cache.push(null);
            }
        });
        for (let i = 0; i < rowCount; i += 1) {
            const row = document.createElement("div");
            row.className = "world__row";
            row.setAttribute("aria-hidden", "true");
            container.appendChild(row);
            rows.push(row);
            cache.push(null);
        }
        return { cols, rows: rowCount };
    }

    /* A prop whose slot has no content behind it — an empty shelf, a cabinet
       with nothing plugged in — is drawn cold and does not pulse. `index` is
       the cell index; kinds absent from `counts` (consoles, signs) are
       always lit. */
    function isUnlit(index, counts) {
        const marker = world.markerLookup.get(index);
        if (!marker) return false;
        const limit = counts[marker.kind];
        return limit !== undefined && marker.index >= limit;
    }

    /* Rebuild each parallax plane's rows and write only the ones that
       changed. */
    function drawPlanes(cols, camX, camY) {
        layers.forEach((layer) => {
            const built = buildPlane({
                cols,
                rows: layer.rows.length,
                camX,
                camY,
                plane: layer.plane,
                colors: layer.colors,
            });
            for (let i = 0; i < built.length; i += 1) {
                if (layer.cache[i] === built[i]) continue;
                layer.rows[i].innerHTML = built[i];
                layer.cache[i] = built[i];
            }
        });
    }

    function draw({ cols, camX, camY, player, time, counts }) {
        drawPlanes(cols, camX, camY);
        /* Torch flicker swings 0.82..1 (period about 0.7s); the prop pulse
           swings 0..1 (about 1.6s); glyph animation advances every 190ms. */
        const flicker = 0.82 + 0.18 * Math.sin(time * 0.009);
        const pulse = 0.5 + 0.5 * Math.sin(time * 0.004);
        const frame = Math.floor(time / 190);

        for (let ry = 0; ry < rows.length; ry += 1) {
            const wy = camY + ry;
            let html = "";
            let runColor = null;
            let runText = "";

            for (let rx = 0; rx < cols; rx += 1) {
                const wx = camX + rx;
                let kind;
                let ch;
                let rgb;
                let unlit = false;
                let zone = 0;

                if (wx < 0 || wy < 0 || wx >= world.w || wy >= world.h) {
                    kind = KIND.VOID;
                    ch = " ";
                    rgb = PALETTE[KIND.VOID];
                } else {
                    const i = wy * world.w + wx;
                    kind = world.kinds[i];
                    zone = world.zones[i];
                    /* Offsetting by position keeps neighbouring water, stars
                       and torches out of step with each other, so they
                       shimmer instead of blinking in unison. */
                    ch = ANIMATED.has(kind)
                        ? ANIM_FRAMES[kind][(frame + wx * 3 + wy * 5) & 3]
                        : world.chars[i];
                    unlit = INTERACTIVE[kind] ? isUnlit(i, counts) : false;
                    rgb = unlit
                        ? UNLIT
                        : zoneColors[zone][kind] || PALETTE[kind];
                }

                const isPlayer = wx === player.x && wy === player.y;
                if (isPlayer) {
                    ch = "@";
                    rgb = PLAYER_COLOR;
                }

                /* Light is additive: the room's ambient plus a small constant
                   lift, then the player's pool, baked torches, the glow of
                   torch and prop cells themselves. Clamped when quantised. */
                let light = world.zoneAmbient[zone] + 0.12;
                const d = Math.hypot(wx - player.x, wy - player.y);
                if (d < PLAYER_RADIUS) {
                    /* Squared falloff rather than linear: a bright pool around
                       you that drops away fast, instead of an even wash. */
                    const t = 1 - d / PLAYER_RADIUS;
                    light += PLAYER_LIGHT * t * t;
                }
                if (wx >= 0 && wy >= 0 && wx < world.w && wy < world.h) {
                    light += torchLight[wy * world.w + wx] * flicker;
                }
                if (kind === KIND.TORCH) light += 0.3 * flicker;
                if (INTERACTIVE[kind] && !unlit) light += 0.12 + 0.2 * pulse;
                if (isPlayer) light = 1;

                /*
                 * Grain. Neighbouring cells of one kind sit a notch apart in
                 * brightness, so a field reads as texture instead of a
                 * repeated glyph.
                 *
                 * It is applied to the light level rather than by mixing a
                 * new colour per cell: levels are already quantised, so
                 * neighbours often land on the same one and long runs still
                 * collapse into a single span. Doing it in colour space
                 * tripled the number of spans per row for the same look.
                 */
                if (!isPlayer && !unlit && GRAINED.has(kind)) {
                    light += GRAIN_SPREAD[shadeAt(wx, wy)];
                }

                const level = Math.max(
                    0,
                    Math.min(LEVELS - 1, Math.round(light * (LEVELS - 1)))
                );
                /* Identifies the base colour for the cache: it only depends on
                   kind and zone (tint), unless it is the player or unlit. */
                const salt = isPlayer ? "p" : unlit ? "u" : `${kind}:${zone}`;
                const color = colorOf(rgb, level, salt);

                if (color !== runColor) {
                    if (runColor !== null) {
                        html += `<span style="color:${runColor}">${runText}</span>`;
                    }
                    runColor = color;
                    runText = "";
                }
                runText += cellMarkup(ch);
            }

            if (runColor !== null) {
                html += `<span style="color:${runColor}">${runText}</span>`;
            }
            if (cache[ry] !== html) {
                rows[ry].innerHTML = html;
                cache[ry] = html;
            }
        }
    }

    return { setSize, draw };
}

/*
 * Measures one character cell so the viewport can be sized in whole glyphs.
 * `probe` is a hidden element holding exactly 40 wide characters in the
 * stage's font (the .world-probe span in pages/World.js); averaging over 40
 * avoids the rounding error of measuring a single glyph. Returns {width,
 * height} in CSS pixels, falling back to 8x16 when layout reports zero.
 */
export function measureCell(probe) {
    const rect = probe.getBoundingClientRect();
    return {
        width: rect.width / 40 || 8,
        height: rect.height || 16,
    };
}

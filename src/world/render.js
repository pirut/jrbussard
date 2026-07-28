import { cellMarkup } from "../lib/glyph";
import {
    KIND,
    PALETTE,
    PLAYER_COLOR,
    ANIMATED,
    ANIM_FRAMES,
    INTERACTIVE,
} from "./tiles";

const PLAYER_LIGHT = 0.7;
const PLAYER_RADIUS = 14;
const TORCH_RADIUS = 8;
const LEVELS = 12;
const UNLIT = [72, 84, 108];

function hex(rgb, t) {
    const bg = PALETTE.bg;
    const mix = (a, b) => Math.round(b + (a - b) * t);
    const value =
        (mix(rgb[0], bg[0]) << 16) | (mix(rgb[1], bg[1]) << 8) | mix(rgb[2], bg[2]);
    return `#${value.toString(16).padStart(6, "0")}`;
}

/* Colour lookups are pure functions of (kind, brightness level), so memoising
   them keeps the per-frame work down to string building. */
function makeColorCache() {
    const cache = new Map();
    return (rgb, level, salt) => {
        const key = `${salt}:${level}`;
        let value = cache.get(key);
        if (value === undefined) {
            value = hex(rgb, 0.16 + (level / (LEVELS - 1)) * 0.84);
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

/* Floors and walls take on their room's colour; props keep their own so they
   stay recognisable from room to room. */
const TINTABLE = [KIND.FLOOR, KIND.WALL];
const TINT_STRENGTH = { [KIND.FLOOR]: 0.34, [KIND.WALL]: 0.46 };

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

export function createRenderer(container, world) {
    const torchLight = bakeTorchLight(world);
    const zoneColors = bakeZoneColors(world);
    const colorOf = makeColorCache();
    let rows = [];
    let cache = [];
    let lastCols = 0;

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
        for (let i = 0; i < rowCount; i += 1) {
            const row = document.createElement("div");
            row.className = "world__row";
            container.appendChild(row);
            rows.push(row);
            cache.push(null);
        }
        return { cols, rows: rowCount };
    }

    /* A prop whose slot has no content behind it — an empty shelf, a cabinet
       with nothing plugged in — is drawn cold and does not pulse. */
    function isUnlit(index, counts) {
        const marker = world.markerLookup.get(index);
        if (!marker) return false;
        const limit = counts[marker.kind];
        return limit !== undefined && marker.index >= limit;
    }

    function draw({ cols, camX, camY, player, time, counts }) {
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

                let light = world.zoneAmbient[zone];
                const d = Math.hypot(wx - player.x, wy - player.y);
                if (d < PLAYER_RADIUS) {
                    light += PLAYER_LIGHT * (1 - d / PLAYER_RADIUS);
                }
                if (wx >= 0 && wy >= 0 && wx < world.w && wy < world.h) {
                    light += torchLight[wy * world.w + wx] * flicker;
                }
                if (kind === KIND.TORCH) light += 0.3 * flicker;
                if (INTERACTIVE[kind] && !unlit) light += 0.12 + 0.2 * pulse;
                if (isPlayer) light = 1;

                const level = Math.max(
                    0,
                    Math.min(LEVELS - 1, Math.round(light * (LEVELS - 1)))
                );
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

/* Measures one character cell so the viewport can be sized in whole glyphs. */
export function measureCell(probe) {
    const rect = probe.getBoundingClientRect();
    return {
        width: rect.width / 40 || 8,
        height: rect.height || 16,
    };
}

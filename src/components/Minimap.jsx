import React, { useMemo } from "react";
import { KIND, PALETTE } from "../world/tiles";
import { cellMarkup } from "../lib/glyph";

const STEP = 3;

/* What a downsampled block should look like, most important first. */
const PRIORITY = [
    { kind: KIND.BOOK, ch: "▤" },
    { kind: KIND.PROJECT, ch: "◈" },
    { kind: KIND.REPO, ch: "★" },
    { kind: KIND.ARCADE, ch: "▣" },
    { kind: KIND.BEACON, ch: "◉" },
    { kind: KIND.STATUE, ch: "☻" },
    { kind: KIND.CONSOLE, ch: "¤" },
    { kind: KIND.SIGN, ch: "¶" },
    { kind: KIND.TORCH, ch: "‡" },
    { kind: KIND.WALL, ch: "▒" },
    { kind: KIND.FLOOR, ch: "·" },
    { kind: KIND.WATER, ch: "≈" },
    { kind: KIND.MOUNTAIN, ch: "▲" },
    { kind: KIND.TREE, ch: "♠" },
    { kind: KIND.GRASS, ch: "," },
];

const KEY = [
    { glyph: "@", label: "you" },
    { glyph: "▤", label: "notes" },
    { glyph: "◈", label: "projects" },
    { glyph: "★", label: "repos" },
    { glyph: "▣", label: "arcade" },
    { glyph: "◉", label: "contact" },
    { glyph: "☻", label: "about" },
    { glyph: "¤", label: "terminals" },
    { glyph: "¶", label: "signposts" },
];

const LABEL_COLOR = "#e8c37a";
const PLAYER_COLOR = "#fff6d5";
const VOID_COLOR = "#05070d";

function rgbToHex([r, g, b], t) {
    const mix = (c, bg) => Math.round(bg + (c - bg) * t);
    const bg = PALETTE.bg;
    return `#${((mix(r, bg[0]) << 16) | (mix(g, bg[1]) << 8) | mix(b, bg[2]))
        .toString(16)
        .padStart(6, "0")}`;
}

function buildMap(world, player) {
    const cols = Math.ceil(world.w / STEP);
    const rows = Math.ceil(world.h / STEP);
    const playerCol = Math.floor(player.x / STEP);
    const playerRow = Math.floor(player.y / STEP);

    /* 1. Downsample the world into cells. */
    const cells = [];
    for (let row = 0; row < rows; row += 1) {
        const line = [];
        for (let col = 0; col < cols; col += 1) {
            const present = new Set();
            for (let dy = 0; dy < STEP; dy += 1) {
                for (let dx = 0; dx < STEP; dx += 1) {
                    const x = col * STEP + dx;
                    const y = row * STEP + dy;
                    if (x >= world.w || y >= world.h) continue;
                    present.add(world.kinds[y * world.w + x]);
                }
            }
            const pick = PRIORITY.find((entry) => present.has(entry.kind));
            line.push({
                ch: pick ? pick.ch : " ",
                color: pick
                    ? rgbToHex(PALETTE[pick.kind], pick.kind === KIND.GRASS ? 0.45 : 0.95)
                    : VOID_COLOR,
            });
        }
        cells.push(line);
    }

    /* 2. Name each room, just inside its top wall, so the map reads as a
       map rather than a texture. */
    world.rooms.forEach((room) => {
        const label = room.name.replace(/^THE /, "");
        const row = Math.floor((room.y + 1) / STEP) + 1;
        const centre = (room.x + room.w / 2) / STEP;
        const start = Math.round(centre - label.length / 2);
        if (row < 0 || row >= rows) return;
        for (let i = 0; i < label.length; i += 1) {
            const col = start + i;
            if (col < 0 || col >= cols) continue;
            cells[row][col] = { ch: label[i], color: LABEL_COLOR };
        }
    });

    /* 3. You, on top of everything. */
    if (cells[playerRow] && cells[playerRow][playerCol]) {
        cells[playerRow][playerCol] = { ch: "@", color: PLAYER_COLOR, player: true };
    }

    /* 4. Serialise, grouping runs of one colour. */
    let html = "";
    cells.forEach((line) => {
        let runColor = null;
        let runText = "";
        line.forEach((cell) => {
            if (cell.color !== runColor) {
                if (runColor !== null) html += `<span style="color:${runColor}">${runText}</span>`;
                runColor = cell.color;
                runText = "";
            }
            runText += cell.player
                ? `<b class="minimap__you">${cellMarkup(cell.ch)}</b>`
                : cellMarkup(cell.ch);
        });
        if (runColor !== null) html += `<span style="color:${runColor}">${runText}</span>`;
        html += "\n";
    });

    return html;
}

export default function Minimap({ world, player, onClose }) {
    const html = useMemo(() => buildMap(world, player), [world, player]);

    return (
        <div className="panel-layer" onPointerDown={onClose}>
            <div
                className="panel panel--map"
                role="dialog"
                aria-modal="true"
                aria-label="World map"
                onPointerDown={(event) => event.stopPropagation()}
            >
                <header className="panel__bar">
                    <span>WORLD MAP</span>
                    <button type="button" onClick={onClose}>
                        [esc] close
                    </button>
                </header>
                <div className="panel__scroll">
                    {/* Generated entirely from the tile grid above. */}
                    <pre
                        className="minimap"
                        dangerouslySetInnerHTML={{ __html: html }}
                    />
                    <ul className="minimap__legend">
                        {KEY.map((entry) => (
                            <li key={entry.label}>
                                <b>{entry.glyph}</b> {entry.label}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}

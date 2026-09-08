import React, { useMemo } from "react";
import { KIND, PALETTE } from "../world/tiles";
import { cellMarkup } from "../lib/glyph";

const SYMBOLS = {
    atrium: "@",
    library: "▤",
    foundry: "◈",
    observatory: "★",
    arcade: "▣",
    beacon: "◉",
};

// Use the actual world geometry so the entrance and the walkable map agree.
export default function Atlas({ world, onTravel }) {
    const html = useMemo(() => {
        let result = "";
        for (let y = 0; y < world.h; y += 1) {
            result += '<span class="atlas__row">';
            let previous = null;
            for (let x = 0; x < world.w; x += 1) {
                const i = y * world.w + x;
                const kind = world.kinds[i];
                const visible = kind !== KIND.LABEL && kind !== KIND.FLOOR;
                const color = PALETTE[kind];
                const opacity =
                    kind === KIND.GRASS
                        ? 0.35
                        : world.zones[i] > 0
                          ? 0.85
                          : 0.65;
                const style = `color:rgb(${color.join(",")});opacity:${opacity}`;
                if (style !== previous) {
                    if (previous !== null) result += "</span>";
                    result += `<span style="${style}">`;
                    previous = style;
                }
                result += cellMarkup(
                    visible ? world.chars[i] : kind === KIND.FLOOR ? "·" : " ",
                );
            }
            result += "</span></span>";
        }
        return result;
    }, [world]);

    return (
        <div className="atlas">
            <pre
                className="atlas__terrain"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: html }}
            />
            {world.rooms.map((room) => (
                <button
                    type="button"
                    key={room.id}
                    className="atlas__room"
                    style={{
                        left: `${((room.x + room.w / 2) / world.w) * 100}%`,
                        top: `${((room.y + room.h / 2) / world.h) * 100}%`,
                    }}
                    onClick={() => onTravel(room.id)}
                    aria-label={`Visit the ${room.id}`}
                >
                    <span>{room.name.replace("THE ", "").toLowerCase()}</span>
                    <b aria-hidden="true">{SYMBOLS[room.id]}</b>
                </button>
            ))}
        </div>
    );
}

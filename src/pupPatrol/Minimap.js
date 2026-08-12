import React, { useEffect, useRef } from "react";
import { WORLD_HALF, PLACES, roads, heightAt } from "./world";

/*
 * The minimap is painted once into an offscreen canvas — coastline, roads and
 * landmarks never change — and then each frame only the moving parts are drawn
 * on top of that cached image. Redrawing the island every frame would cost more
 * than the rest of the HUD put together.
 */

const SIZE = 168;
const RANGE = WORLD_HALF + 40;

function paintIsland() {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE * 2;
    canvas.height = SIZE * 2;
    const ctx = canvas.getContext("2d");
    const scale = (SIZE * 2) / (RANGE * 2);
    const toX = (x) => (x + RANGE) * scale;
    const toY = (z) => (z + RANGE) * scale;

    ctx.fillStyle = "#12507f";
    ctx.fillRect(0, 0, SIZE * 2, SIZE * 2);

    /* Land, sampled coarsely. */
    const step = 5;
    for (let z = -RANGE; z < RANGE; z += step) {
        for (let x = -RANGE; x < RANGE; x += step) {
            const h = heightAt(x, z);
            if (h < 0) continue;
            ctx.fillStyle =
                h < 3 ? "#e6d7a8" : h < 26 ? "#5fa83a" : h < 50 ? "#4a8c31" : h < 66 ? "#8b8378" : "#f2f7fb";
            ctx.fillRect(toX(x), toY(z), step * scale + 1, step * scale + 1);
        }
    }

    ctx.strokeStyle = "#3f434b";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    roads.forEach((road) => {
        ctx.beginPath();
        road.path.forEach(([x, z], i) => {
            if (i === 0) ctx.moveTo(toX(x), toY(z));
            else ctx.lineTo(toX(x), toY(z));
        });
        ctx.stroke();
    });

    PLACES.forEach((place) => {
        ctx.fillStyle = place.kind === "hq" ? "#ffd23f" : "rgba(255,255,255,0.82)";
        ctx.beginPath();
        ctx.arc(toX(place.x), toY(place.z), place.kind === "hq" ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
    });

    return canvas;
}

let cached = null;

export default function Minimap({ x, z, heading, markers }) {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!cached) cached = paintIsland();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !cached) return;
        const ctx = canvas.getContext("2d");
        const scale = SIZE / (RANGE * 2);
        const toX = (wx) => (wx + RANGE) * scale;
        const toY = (wz) => (wz + RANGE) * scale;

        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(cached, 0, 0, SIZE, SIZE);

        (markers || []).forEach((marker) => {
            const colour = `#${(marker.colour || 0xffffff).toString(16).padStart(6, "0")}`;
            ctx.fillStyle = colour;
            ctx.strokeStyle = "rgba(0,0,0,0.5)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(toX(marker.x), toY(marker.z), 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });

        /* You, as an arrow pointing the way you are facing. */
        const px = toX(x || 0);
        const py = toY(z || 0);
        ctx.save();
        ctx.translate(px, py);
        /* The arrow is drawn pointing at (0,-1). Rotating by PI - heading puts
           it on the vehicle's forward vector (sin h, cos h), remembering that
           map Y runs the same way as world +Z. */
        ctx.rotate(Math.PI - (heading || 0));
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#12212f";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4.2, 5);
        ctx.lineTo(0, 2.6);
        ctx.lineTo(-4.2, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }, [x, z, heading, markers]);

    return <canvas className="bay__minimap" ref={canvasRef} width={SIZE} height={SIZE} aria-hidden="true" />;
}

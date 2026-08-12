import React, { useEffect, useRef } from "react";
import { WORLD_HALF, PLACES, roads, heightAt } from "./world";

/*
 * The minimap is painted once into an offscreen canvas — coastline, roads and
 * landmarks never change — and then each frame only the moving parts are drawn
 * on top of that cached image. Redrawing the island every frame would cost more
 * than the rest of the HUD put together.
 *
 * It is drawn north-up rather than rotating with the car. A rotating map is
 * better for "which way do I turn now" and much worse for "where am I", and
 * with a whole island to learn, knowing where you are is the harder problem.
 * The heading cone covers the other case.
 */

const SIZE = 172;
const SUPERSAMPLE = 3;
const RANGE = WORLD_HALF + 40;

function paintIsland() {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE * SUPERSAMPLE;
    canvas.height = SIZE * SUPERSAMPLE;
    const ctx = canvas.getContext("2d");
    const scale = (SIZE * SUPERSAMPLE) / (RANGE * 2);
    const toX = (x) => (x + RANGE) * scale;
    const toY = (z) => (z + RANGE) * scale;

    /* Open water, deepening away from the coast. */
    const sea = ctx.createRadialGradient(
        (SIZE * SUPERSAMPLE) / 2,
        (SIZE * SUPERSAMPLE) / 2,
        SIZE * SUPERSAMPLE * 0.24,
        (SIZE * SUPERSAMPLE) / 2,
        (SIZE * SUPERSAMPLE) / 2,
        SIZE * SUPERSAMPLE * 0.6
    );
    sea.addColorStop(0, "#1c76ad");
    sea.addColorStop(1, "#0d3f6b");
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, SIZE * SUPERSAMPLE, SIZE * SUPERSAMPLE);

    /* Land, sampled coarsely, with a cheap hillshade: comparing each sample to
       its neighbour up-sun gives slopes a light and a dark side, and turns a
       flat green blob into something with a mountain on it. */
    const step = 3;
    for (let z = -RANGE; z < RANGE; z += step) {
        for (let x = -RANGE; x < RANGE; x += step) {
            const h = heightAt(x, z);
            if (h < 0) continue;
            const lit = h - heightAt(x - step, z - step);
            const shade = Math.max(-0.32, Math.min(0.32, lit * 0.13));

            let base;
            if (h < 3) base = [230, 215, 168];
            else if (h < 26) base = [95, 168, 58];
            else if (h < 50) base = [74, 140, 49];
            else if (h < 66) base = [139, 131, 120];
            else base = [242, 247, 251];

            const k = 1 + shade;
            ctx.fillStyle = `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
            ctx.fillRect(toX(x), toY(z), step * scale + 1, step * scale + 1);
        }
    }

    /* Roads: a dark casing with a lighter fill on top, so they read at this
       size instead of vanishing into the green. */
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    [
        { colour: "rgba(28,30,36,0.85)", width: 6 },
        { colour: "#d8dbe2", width: 3 },
    ].forEach((pass) => {
        ctx.strokeStyle = pass.colour;
        ctx.lineWidth = pass.width;
        roads.forEach((road) => {
            ctx.beginPath();
            road.path.forEach(([x, z], i) => {
                if (i === 0) ctx.moveTo(toX(x), toY(z));
                else ctx.lineTo(toX(x), toY(z));
            });
            ctx.stroke();
        });
    });

    PLACES.forEach((place) => {
        const hq = place.kind === "hq";
        ctx.fillStyle = hq ? "#ffd23f" : "rgba(255,255,255,0.9)";
        ctx.strokeStyle = "rgba(12,26,42,0.75)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(toX(place.x), toY(place.z), hq ? 7 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });

    return canvas;
}

let cached = null;

export default function Minimap({ x, z, heading, markers, pulse }) {
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

        const px = toX(x || 0);
        const py = toY(z || 0);

        /* Which way you are pointing, as a wedge of light out in front. */
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(Math.PI - (heading || 0));
        const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
        cone.addColorStop(0, "rgba(255,255,255,0.34)");
        cone.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = cone;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 34, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        (markers || []).forEach((marker) => {
            const colour = `#${(marker.colour || 0xffffff).toString(16).padStart(6, "0")}`;
            const mx = toX(marker.x);
            const my = toY(marker.z);

            /* A ring that breathes, so the live objective is never something
               you have to hunt for among the landmarks. */
            const grow = 5.5 + Math.sin((pulse || 0) * 4) * 1.8;
            ctx.strokeStyle = colour;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(mx, my, grow + 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;

            ctx.fillStyle = colour;
            ctx.strokeStyle = "rgba(0,0,0,0.55)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });

        /* You, as an arrow pointing the way you are facing. */
        ctx.save();
        ctx.translate(px, py);
        /* The arrow is drawn pointing at (0,-1). Rotating by PI - heading puts
           it on the vehicle's forward vector (sin h, cos h), remembering that
           map Y runs the same way as world +Z. */
        ctx.rotate(Math.PI - (heading || 0));
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#12212f";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(4.6, 5.4);
        ctx.lineTo(0, 2.8);
        ctx.lineTo(-4.6, 5.4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }, [x, z, heading, markers, pulse]);

    return <canvas className="bay__minimap" ref={canvasRef} width={SIZE} height={SIZE} aria-hidden="true" />;
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import GameShell, {
    Screen,
    Pad,
    useBestScore,
    useGameLoop,
} from "./GameShell";

const COLS = 44;
const ROWS = 22;
const START_MS = 130;
const FLOOR_MS = 55;

const COLORS = {
    "#": "#5d6a86",
    "@": "#fff6d5",
    o: "#7ee0c0",
    "●": "#ffb347",
    "*": "#ff7ad9",
    " ": "#05070d",
};

const VECTORS = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
};

const KEYS = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    a: "left",
    s: "down",
    d: "right",
};

const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

function freshGame() {
    const mid = { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
    return {
        snake: [
            { x: mid.x - 2, y: mid.y },
            { x: mid.x - 1, y: mid.y },
            { x: mid.x, y: mid.y },
        ],
        direction: "right",
        food: { x: mid.x + 6, y: mid.y },
        bonus: null,
        score: 0,
        alive: true,
    };
}

function placeFood(snake) {
    /* Interior only, and never underneath the snake. */
    for (let attempt = 0; attempt < 400; attempt += 1) {
        const x = 1 + Math.floor(Math.random() * (COLS - 2));
        const y = 1 + Math.floor(Math.random() * (ROWS - 2));
        if (!snake.some((part) => part.x === x && part.y === y)) return { x, y };
    }
    return { x: 1, y: 1 };
}

export default function Snake() {
    const [game, setGame] = useState(freshGame);
    const [phase, setPhase] = useState("ready");
    const [best, submitBest] = useBestScore("snake");
    const [bestScore, setBestScore] = useState(best);
    const queued = useRef([]);

    useEffect(() => {
        document.title = "SNAKE — JR Bussard's arcade";
    }, []);

    const start = useCallback(() => {
        queued.current = [];
        setGame(freshGame());
        setPhase("playing");
    }, []);

    const turn = useCallback((direction) => {
        /* Queue turns so a fast double-tap round a corner is not swallowed. */
        if (queued.current.length < 2) queued.current.push(direction);
    }, []);

    useEffect(() => {
        const onKeyDown = (event) => {
            const direction = KEYS[event.key] || KEYS[event.key.toLowerCase()];
            if (direction) {
                event.preventDefault();
                turn(direction);
                return;
            }
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setPhase((current) => {
                    if (current === "playing") return "paused";
                    if (current === "paused") return "playing";
                    return current;
                });
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [turn]);

    const tick = useCallback(() => {
        setGame((prev) => {
            if (!prev.alive) return prev;

            let direction = prev.direction;
            while (queued.current.length) {
                const next = queued.current.shift();
                if (next !== OPPOSITE[direction]) {
                    direction = next;
                    break;
                }
            }

            const [dx, dy] = VECTORS[direction];
            const head = {
                x: prev.snake[prev.snake.length - 1].x + dx,
                y: prev.snake[prev.snake.length - 1].y + dy,
            };

            const hitWall =
                head.x <= 0 || head.y <= 0 || head.x >= COLS - 1 || head.y >= ROWS - 1;
            const hitSelf = prev.snake.some(
                (part, i) => i > 0 && part.x === head.x && part.y === head.y
            );
            if (hitWall || hitSelf) return { ...prev, direction, alive: false };

            const snake = prev.snake.concat(head);
            let { food, bonus, score } = prev;

            const ateBonus = bonus && head.x === bonus.x && head.y === bonus.y;
            const ateFood = head.x === food.x && head.y === food.y;

            if (ateFood) {
                score += 10;
                food = placeFood(snake);
                /* Every fifth apple leaves a bonus behind for a short while. */
                bonus = score % 50 === 0 ? placeFood(snake.concat(food)) : bonus;
            } else if (ateBonus) {
                score += 50;
                bonus = null;
                snake.shift();
            } else {
                snake.shift();
            }

            return { ...prev, snake, direction, food, bonus, score };
        });
    }, []);

    const speed = Math.max(FLOOR_MS, START_MS - Math.floor(game.score / 10) * 4);
    useGameLoop(tick, speed, phase === "playing" && game.alive);

    useEffect(() => {
        if (game.alive || phase !== "playing") return;
        setPhase("over");
        setBestScore(submitBest(game.score));
    }, [game.alive, game.score, phase, submitBest]);

    /* Paint the board. */
    const rows = [];
    for (let y = 0; y < ROWS; y += 1) {
        const row = new Array(COLS).fill(" ");
        for (let x = 0; x < COLS; x += 1) {
            if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) row[x] = "#";
        }
        rows.push(row);
    }
    game.snake.forEach((part, i) => {
        rows[part.y][part.x] = i === game.snake.length - 1 ? "@" : "o";
    });
    rows[game.food.y][game.food.x] = "●";
    if (game.bonus) rows[game.bonus.y][game.bonus.x] = "*";

    const status =
        phase === "ready"
            ? "SNAKE"
            : phase === "paused"
            ? "PAUSED"
            : phase === "over"
            ? "GAME OVER"
            : null;

    const hint =
        phase === "over"
            ? `You scored ${game.score}. Best is ${bestScore}.`
            : phase === "paused"
            ? "Press enter to carry on."
            : "Eat the apples. Pink ones are worth five.";

    return (
        <GameShell
            title="SNAKE"
            tagline="do not eat yourself"
            stats={[
                { label: "score", value: game.score },
                { label: "best", value: bestScore },
                { label: "length", value: game.snake.length },
            ]}
            status={status}
            statusHint={hint}
            onStart={start}
            controls="wasd / arrows to steer · enter to pause"
            pad={<Pad directions="all" onPress={turn} onAct={start} actLabel="GO" />}
        >
            <Screen rows={rows.map((row) => row.join(""))} colorFor={(ch) => COLORS[ch]} />
        </GameShell>
    );
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import GameShell, {
    Screen,
    Pad,
    useBestScore,
    useGameLoop,
} from "./GameShell";

const COLS = 46;
const ROWS = 24;
const TICK_MS = 42;
const PADDLE_W = 7;
const BRICK_ROWS = 5;
const BRICK_W = 4;
const BRICK_TOP = 3;

const ROW_COLORS = ["#ff7ad9", "#ffb347", "#ffd977", "#7ee0c0", "#7fd7ff"];

const COLORS = {
    "#": "#5d6a86",
    "=": "#fff6d5",
    o: "#ffb347",
    " ": "#05070d",
};

const KEYS = { ArrowLeft: -1, ArrowRight: 1, a: -1, d: 1 };

function freshBricks() {
    const bricks = [];
    const perRow = Math.floor((COLS - 4) / BRICK_W);
    for (let row = 0; row < BRICK_ROWS; row += 1) {
        for (let col = 0; col < perRow; col += 1) {
            bricks.push({
                x: 2 + col * BRICK_W,
                y: BRICK_TOP + row,
                w: BRICK_W - 1,
                row,
                alive: true,
            });
        }
    }
    return bricks;
}

function freshGame() {
    return {
        paddle: Math.floor((COLS - PADDLE_W) / 2),
        ball: { x: COLS / 2, y: ROWS - 4 },
        velocity: { x: 0.55, y: -0.7 },
        bricks: freshBricks(),
        score: 0,
        lives: 3,
        alive: true,
        won: false,
    };
}

export default function Breakout() {
    const [game, setGame] = useState(freshGame);
    const [phase, setPhase] = useState("ready");
    const [best, submitBest] = useBestScore("breakout");
    const [bestScore, setBestScore] = useState(best);
    const held = useRef(0);

    useEffect(() => {
        document.title = "BREAKOUT — JR Bussard's arcade";
    }, []);

    const start = useCallback(() => {
        setGame(freshGame());
        setPhase("playing");
    }, []);

    const nudge = useCallback((direction) => {
        setGame((prev) => ({
            ...prev,
            paddle: Math.max(
                1,
                Math.min(COLS - PADDLE_W - 1, prev.paddle + direction * 3)
            ),
        }));
    }, []);

    useEffect(() => {
        const onKeyDown = (event) => {
            const direction = KEYS[event.key] || KEYS[event.key.toLowerCase()];
            if (direction) {
                event.preventDefault();
                held.current = direction;
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
        const onKeyUp = (event) => {
            const direction = KEYS[event.key] || KEYS[event.key.toLowerCase()];
            if (direction === held.current) held.current = 0;
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, []);

    const tick = useCallback(() => {
        setGame((prev) => {
            if (!prev.alive || prev.won) return prev;

            const paddle = Math.max(
                1,
                Math.min(COLS - PADDLE_W - 1, prev.paddle + held.current * 1.6)
            );

            let { x, y } = prev.ball;
            let vx = prev.velocity.x;
            let vy = prev.velocity.y;
            x += vx;
            y += vy;

            if (x <= 1) {
                x = 1;
                vx = Math.abs(vx);
            }
            if (x >= COLS - 2) {
                x = COLS - 2;
                vx = -Math.abs(vx);
            }
            if (y <= 1) {
                y = 1;
                vy = Math.abs(vy);
            }

            /* Paddle: bounce angle depends on where it hits. */
            const paddleRow = ROWS - 2;
            if (
                vy > 0 &&
                y >= paddleRow - 0.5 &&
                y <= paddleRow + 0.5 &&
                x >= paddle - 0.5 &&
                x <= paddle + PADDLE_W - 0.5
            ) {
                const offset = (x - (paddle + PADDLE_W / 2)) / (PADDLE_W / 2);
                vx = Math.max(-1, Math.min(1, offset)) * 0.85;
                vy = -Math.abs(vy);
                y = paddleRow - 0.6;
            }

            /* Bricks. */
            let score = prev.score;
            const bricks = prev.bricks.map((brick) => {
                if (!brick.alive) return brick;
                const hit =
                    Math.round(y) === brick.y &&
                    x >= brick.x - 0.5 &&
                    x <= brick.x + brick.w - 0.5;
                if (!hit) return brick;
                score += (BRICK_ROWS - brick.row) * 10;
                vy = -vy;
                return { ...brick, alive: false };
            });

            const won = bricks.every((brick) => !brick.alive);

            /* Missed. */
            if (y >= ROWS - 1) {
                const lives = prev.lives - 1;
                if (lives <= 0) {
                    return { ...prev, paddle, bricks, score, lives: 0, alive: false };
                }
                return {
                    ...prev,
                    paddle,
                    bricks,
                    score,
                    lives,
                    ball: { x: COLS / 2, y: ROWS - 4 },
                    velocity: { x: 0.55, y: -0.7 },
                };
            }

            return {
                ...prev,
                paddle,
                bricks,
                score,
                won,
                ball: { x, y },
                velocity: { x: vx, y: vy },
            };
        });
    }, []);

    useGameLoop(tick, TICK_MS, phase === "playing" && game.alive && !game.won);

    useEffect(() => {
        if (phase !== "playing") return;
        if (game.alive && !game.won) return;
        setPhase(game.won ? "won" : "over");
        setBestScore(submitBest(game.score));
    }, [game.alive, game.won, game.score, phase, submitBest]);

    /* Paint. */
    const rows = [];
    for (let y = 0; y < ROWS; y += 1) {
        const row = new Array(COLS).fill(" ");
        for (let x = 0; x < COLS; x += 1) {
            if (x === 0 || y === 0 || x === COLS - 1) row[x] = "#";
        }
        rows.push(row);
    }
    /* Bricks carry their row index so each band keeps its own colour. */
    const brickRowAt = new Array(COLS * ROWS).fill(-1);
    game.bricks.forEach((brick) => {
        if (!brick.alive) return;
        for (let i = 0; i < brick.w; i += 1) {
            rows[brick.y][brick.x + i] = "▄";
            brickRowAt[brick.y * COLS + brick.x + i] = brick.row;
        }
    });
    for (let i = 0; i < PADDLE_W; i += 1) {
        rows[ROWS - 2][Math.round(game.paddle) + i] = "=";
    }
    const ballX = Math.max(1, Math.min(COLS - 2, Math.round(game.ball.x)));
    const ballY = Math.max(1, Math.min(ROWS - 2, Math.round(game.ball.y)));
    rows[ballY][ballX] = "o";

    const colorFor = (ch, x, y) => {
        if (ch === "▄") return ROW_COLORS[brickRowAt[y * COLS + x]] || "#7ee0c0";
        return COLORS[ch] || "#5d6a86";
    };

    const status =
        phase === "ready"
            ? "BREAKOUT"
            : phase === "paused"
            ? "PAUSED"
            : phase === "won"
            ? "CLEARED"
            : phase === "over"
            ? "GAME OVER"
            : null;

    const hint =
        phase === "won"
            ? `Every brick down for ${game.score}. Best is ${bestScore}.`
            : phase === "over"
            ? `You scored ${game.score}. Best is ${bestScore}.`
            : phase === "paused"
            ? "Press enter to carry on."
            : "Clear the wall. The edge of the paddle cuts the angle.";

    return (
        <GameShell
            title="BREAKOUT"
            tagline="clear the wall"
            stats={[
                { label: "score", value: game.score },
                { label: "best", value: bestScore },
                { label: "lives", value: "◉".repeat(game.lives) || "—" },
            ]}
            status={status}
            statusHint={hint}
            onStart={start}
            controls="left / right or a / d · enter to pause"
            pad={
                <Pad
                    directions="lr"
                    onPress={(key) => nudge(key === "left" ? -1 : 1)}
                    onAct={start}
                    actLabel="GO"
                />
            }
        >
            <Screen rows={rows.map((row) => row.join(""))} colorFor={colorFor} />
        </GameShell>
    );
}

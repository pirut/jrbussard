import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "../styles/CharliePawPatrol.css";

const missions = [
    "Chase needs Charlie to find the blue paw badge!",
    "Marshall says Charlie saved the day!",
    "Skye needs Charlie to tap the siren lights!",
    "Rubble wants Charlie to build a happy rescue road!",
    "Everest says Charlie is the fastest helper on the mountain!",
    "Rocky needs Charlie to pop the floating paws!",
];

const pups = [
    {
        name: "Chase",
        color: "#2f78ff",
        accent: "#1548b3",
        emoji: "🐾",
        message: "Chase is on the case, Charlie!",
    },
    {
        name: "Marshall",
        color: "#ff5748",
        accent: "#b92215",
        emoji: "🚒",
        message: "Marshall says Charlie is super brave!",
    },
    {
        name: "Skye",
        color: "#ff74b4",
        accent: "#c83b7a",
        emoji: "🛩️",
        message: "Skye wants Charlie to soar to the sky!",
    },
    {
        name: "Rubble",
        color: "#ffd548",
        accent: "#d39f00",
        emoji: "🚧",
        message: "Rubble says Charlie can dig it!",
    },
];

const sirenPads = [
    { id: "red", label: "Red Siren", color: "#ff4c43", tones: [540, 700, 540] },
    { id: "blue", label: "Blue Siren", color: "#2e76ff", tones: [460, 620, 460] },
    { id: "yellow", label: "Yellow Siren", color: "#ffd437", tones: [380, 520, 650] },
];

const bubbleCount = 7;

function randomFrom(list, avoid) {
    if (list.length === 1) return list[0];
    let pick = list[Math.floor(Math.random() * list.length)];
    while (pick === avoid) {
        pick = list[Math.floor(Math.random() * list.length)];
    }
    return pick;
}

function makeBubble(id) {
    return {
        id,
        left: `${8 + Math.random() * 78}%`,
        top: `${10 + Math.random() * 72}%`,
        size: 78 + Math.round(Math.random() * 36),
        rotation: -14 + Math.round(Math.random() * 28),
        delay: `${Math.random() * 1.8}s`,
        duration: `${3.2 + Math.random() * 1.4}s`,
        popped: false,
    };
}

function CharliePawPatrol() {
    const [audioEnabled, setAudioEnabled] = useState(false);
    const [selectedPup, setSelectedPup] = useState(pups[0]);
    const [currentMission, setCurrentMission] = useState(missions[0]);
    const [missionCount, setMissionCount] = useState(0);
    const [pawPopCount, setPawPopCount] = useState(0);
    const [activeLightColor, setActiveLightColor] = useState("");
    const [celebrationToken, setCelebrationToken] = useState(0);
    const [bubbles, setBubbles] = useState(() => Array.from({ length: bubbleCount }, (_, index) => makeBubble(index)));
    const audioContextRef = useRef(null);
    const timeoutIdsRef = useRef([]);

    useEffect(() => {
        document.title = "Charlie's Paw Patrol HQ";

        return () => {
            timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
            timeoutIdsRef.current = [];

            if (audioContextRef.current && typeof audioContextRef.current.close === "function") {
                audioContextRef.current.close().catch(() => {});
            }
        };
    }, []);

    function trackTimeout(callback, delay) {
        const timeoutId = window.setTimeout(() => {
            timeoutIdsRef.current = timeoutIdsRef.current.filter((id) => id !== timeoutId);
            callback();
        }, delay);

        timeoutIdsRef.current.push(timeoutId);
    }

    async function enableAudio() {
        try {
            const AudioCtor = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtor) return false;

            if (!audioContextRef.current) {
                audioContextRef.current = new AudioCtor();
            }

            if (audioContextRef.current.state === "suspended") {
                await audioContextRef.current.resume();
            }

            return true;
        } catch {
            return false;
        }
    }

    function playToneSequence(sequence, waveform = "triangle", noteLength = 0.11, ignoreToggle = false) {
        if ((!audioEnabled && !ignoreToggle) || !audioContextRef.current) return;

        try {
            const context = audioContextRef.current;
            const startAt = context.currentTime + 0.01;

            sequence.forEach((frequency, index) => {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                const noteStart = startAt + index * noteLength;
                const noteEnd = noteStart + noteLength * 0.88;

                oscillator.type = waveform;
                oscillator.frequency.setValueAtTime(frequency, noteStart);

                gain.gain.setValueAtTime(0.0001, noteStart);
                gain.gain.linearRampToValueAtTime(0.14, noteStart + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.start(noteStart);
                oscillator.stop(noteEnd + 0.02);
            });
        } catch {
            setAudioEnabled(false);
        }
    }

    async function toggleAudio() {
        if (audioEnabled) {
            setAudioEnabled(false);
            return;
        }

        const ready = await enableAudio();
        setAudioEnabled(ready);

        if (ready) {
            playToneSequence([660, 780], "sine", 0.1, true);
        }
    }

    function flashLights(color) {
        setActiveLightColor(color);
        trackTimeout(() => setActiveLightColor(""), 380);
    }

    function startMission() {
        const mission = randomFrom(missions, currentMission);
        setCurrentMission(mission);
        setMissionCount((count) => count + 1);
        setCelebrationToken((token) => token + 1);
        flashLights("#ff6156");
        playToneSequence([523, 659, 784], "triangle", 0.12);
    }

    function choosePup(pup) {
        setSelectedPup(pup);
        flashLights(pup.color);
        playToneSequence([390, 520], "square", 0.09);
    }

    function tapSirenPad(pad) {
        flashLights(pad.color);
        playToneSequence(pad.tones, "sawtooth", 0.09);
    }

    function popBubble(id) {
        setPawPopCount((count) => count + 1);
        setBubbles((current) => current.map((bubble) => (bubble.id === id ? { ...bubble, popped: true } : bubble)));
        playToneSequence([880, 1180], "sine", 0.06);

        trackTimeout(() => {
            setBubbles((current) => current.map((bubble) => (bubble.id === id ? makeBubble(id) : bubble)));
        }, 170);
    }

    return (
        <main className="charlie-patrol" style={{ "--selected-pup": selectedPup.color, "--alert-color": activeLightColor || "transparent" }}>
            <div className="charlie-patrol__sky">
                <div className="charlie-patrol__cloud charlie-patrol__cloud--one" />
                <div className="charlie-patrol__cloud charlie-patrol__cloud--two" />
                <div className="charlie-patrol__cloud charlie-patrol__cloud--three" />
                <div className="charlie-patrol__pawtrail" aria-hidden="true">
                    <span>🐾</span>
                    <span>🐾</span>
                    <span>🐾</span>
                    <span>🐾</span>
                </div>
                <div className="charlie-patrol__lights" />
            </div>

            <div className="charlie-patrol__content">
                <header className="charlie-patrol__topbar">
                    <Link className="charlie-patrol__backlink" to="/">
                        Back to JR&apos;s site
                    </Link>
                    <div className="charlie-patrol__utility-group">
                        <button className="charlie-patrol__sound-toggle" type="button" onClick={toggleAudio} aria-pressed={audioEnabled}>
                            {audioEnabled ? "Sound on" : "Tap for sound"}
                        </button>
                        <p className="charlie-patrol__hq-badge">Charlie&apos;s Pup Patrol HQ</p>
                    </div>
                </header>

                <section className="charlie-patrol__hero">
                    <div className="charlie-patrol__hero-copy">
                        <p className="charlie-patrol__intro">Rescue time with Charlie and the pups.</p>
                        <h1>Charlie&apos;s Paw Patrol HQ!</h1>
                        <p className="charlie-patrol__support">Tap everything. Pop paws. Flash sirens. Help the pups save the day.</p>
                    </div>
                    <div className="charlie-patrol__hero-badge" aria-label="Charlie name badge">
                        <span className="charlie-patrol__hero-badge-top">Top Pup</span>
                        <strong>Charlie</strong>
                        <span className="charlie-patrol__hero-badge-bottom">Ready for rescue</span>
                    </div>
                </section>

                <section className="charlie-patrol__grid">
                    <section className="charlie-panel charlie-panel--mission" aria-labelledby="mission-control-title">
                        <div className="charlie-panel__heading">
                            <h2 id="mission-control-title">Mission Control</h2>
                            <p>Missions completed: {missionCount}</p>
                        </div>
                        <p className="charlie-panel__message">{currentMission}</p>
                        <button className="charlie-patrol__mission-button" type="button" onClick={startMission}>
                            Start Rescue
                        </button>
                        <div key={celebrationToken} className="charlie-patrol__confetti" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                        </div>
                    </section>

                    <section className="charlie-panel charlie-panel--pups" aria-labelledby="meet-the-pups-title">
                        <div className="charlie-panel__heading">
                            <h2 id="meet-the-pups-title">Meet the Pups</h2>
                            <p>Pick a pup for Charlie.</p>
                        </div>
                        <div className="charlie-patrol__pup-list">
                            {pups.map((pup) => {
                                const isActive = selectedPup.name === pup.name;

                                return (
                                    <button
                                        key={pup.name}
                                        className={`charlie-patrol__pup-card${isActive ? " is-active" : ""}`}
                                        type="button"
                                        onClick={() => choosePup(pup)}
                                        style={{ "--pup-color": pup.color, "--pup-accent": pup.accent }}
                                    >
                                        <span className="charlie-patrol__pup-icon" aria-hidden="true">
                                            {pup.emoji}
                                        </span>
                                        <span className="charlie-patrol__pup-name">{pup.name}</span>
                                        <span className="charlie-patrol__pup-copy">{pup.message}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section className="charlie-panel charlie-panel--sirens" aria-labelledby="siren-pad-title">
                        <div className="charlie-panel__heading">
                            <h2 id="siren-pad-title">Siren Pads</h2>
                            <p>Tap the colors, Charlie.</p>
                        </div>
                        <div className="charlie-patrol__siren-row">
                            {sirenPads.map((pad) => (
                                <button
                                    key={pad.id}
                                    className="charlie-patrol__siren-pad"
                                    type="button"
                                    onClick={() => tapSirenPad(pad)}
                                    style={{ "--pad-color": pad.color }}
                                >
                                    {pad.label}
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="charlie-panel charlie-panel--paws" aria-labelledby="paw-pop-title">
                        <div className="charlie-panel__heading">
                            <h2 id="paw-pop-title">Paw Pop</h2>
                            <p>Paws popped: {pawPopCount}</p>
                        </div>
                        <div className="charlie-patrol__paw-field" role="group" aria-label="Floating paw bubbles for Charlie to pop">
                            {bubbles.map((bubble) => (
                                <button
                                    key={bubble.id}
                                    className={`charlie-patrol__paw-bubble${bubble.popped ? " is-popped" : ""}`}
                                    type="button"
                                    onClick={() => popBubble(bubble.id)}
                                    style={{
                                        left: bubble.left,
                                        top: bubble.top,
                                        width: `${bubble.size}px`,
                                        height: `${bubble.size}px`,
                                        "--bubble-rotate": `${bubble.rotation}deg`,
                                        animationDelay: bubble.delay,
                                        animationDuration: bubble.duration,
                                    }}
                                    aria-label="Pop a paw bubble"
                                >
                                    <span className="charlie-patrol__paw-bubble-core" aria-hidden="true">
                                        🐾
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                </section>
            </div>
        </main>
    );
}

export default CharliePawPatrol;

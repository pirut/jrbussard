/*
 * Keyboard, mouse, gamepad and thumbstick, flattened into one control state.
 *
 * Nothing downstream knows which of the four you are using, and all four can
 * be live at once — a parent on the keyboard and a kid on the touchscreen is a
 * real thing that happens.
 *
 * The one piece of real work here is that a keyboard is a digital device being
 * asked to drive an analogue car. Handing the physics a hard -1 or +1 makes
 * every input feel like a switch. Instead the keyboard is integrated into an
 * axis that ramps in and snaps back, which is what every driving game with a
 * keyboard mode does and what makes one playable at all.
 */

const KEY_MAP = {
    KeyW: "up",
    ArrowUp: "up",
    KeyS: "down",
    ArrowDown: "down",
    KeyA: "left",
    ArrowLeft: "left",
    KeyD: "right",
    ArrowRight: "right",
    Space: "handbrake",
    ShiftLeft: "descend",
    ShiftRight: "descend",
    KeyQ: "rollLeft",
    KeyE: "interact",
    KeyF: "ability",
    KeyR: "recover",
    KeyC: "camera",
    KeyV: "camera",
    KeyM: "map",
    Tab: "roster",
    Escape: "pause",
    KeyP: "pause",
    KeyH: "horn",
    Enter: "confirm",
    KeyB: "confirm",
};

/* Number keys pick a pup directly. */
const DIGIT_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7"];

/* Keys the page would otherwise act on: scrolling on space, focus on tab. */
const SWALLOW = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"]);

/* How fast a held key winds the axis in, and how fast letting go winds it
   back. Release is quicker than press because a car's steering self-centres
   and because "stop turning" should be immediate while "start turning" wants
   to be progressive. */
const STEER_ATTACK = 4.6;
const STEER_RELEASE = 9.0;
const PEDAL_ATTACK = 7.0;
const PEDAL_RELEASE = 12.0;

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

/* Sensitivity curve for a real analogue stick: gentle either side of centre,
   full authority at the edges. */
function curve(value, exponent = 1.55) {
    const magnitude = Math.abs(value);
    return Math.sign(value) * Math.pow(magnitude, exponent);
}

function approach(current, target, rate, dt) {
    const delta = target - current;
    const step = rate * dt;
    if (Math.abs(delta) <= step) return target;
    return current + Math.sign(delta) * step;
}

export class Input {
    constructor(target) {
        this.target = target;
        this.keys = new Set();
        this.pressed = new Set();
        this.touch = { steer: 0, throttle: 0, brake: 0, lift: 0, handbrake: false };
        this.enabled = true;
        this.gamepadIndex = null;
        this.digit = 0;

        /* Smoothed axes, so the keyboard behaves like a stick. */
        this.axisSteer = 0;
        this.axisThrottle = 0;
        this.axisBrake = 0;

        /* Free look, accumulated between frames and drained by sample(). */
        this.look = { x: 0, y: 0 };
        this.looking = false;
        this.zoom = 0;
        this.lastPointer = null;

        this.onKeyDown = (event) => {
            if (!this.enabled) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const digit = DIGIT_KEYS.indexOf(event.code);
            if (digit >= 0) {
                this.digit = digit + 1;
                return;
            }
            const action = KEY_MAP[event.code];
            if (!action) return;
            if (SWALLOW.has(event.code)) event.preventDefault();
            if (!this.keys.has(action)) this.pressed.add(action);
            this.keys.add(action);
        };

        this.onKeyUp = (event) => {
            const action = KEY_MAP[event.code];
            if (!action) return;
            this.keys.delete(action);
        };

        /* Losing focus mid-corner used to leave the key stuck down and the car
           driving itself into the sea. */
        this.onBlur = () => {
            this.keys.clear();
            this.looking = false;
            this.lastPointer = null;
        };

        /* ---- free look ----
           Right-drag orbits the camera; releasing hands it back. Left-drag is
           left alone so it can never fight a HUD button. */
        this.onPointerDown = (event) => {
            if (event.button !== 2 && event.button !== 1) return;
            event.preventDefault();
            this.looking = true;
            this.lastPointer = { x: event.clientX, y: event.clientY };
            if (target.setPointerCapture) {
                try {
                    target.setPointerCapture(event.pointerId);
                } catch {
                    /* Capture is a nicety; dragging still works without it. */
                }
            }
        };

        this.onPointerMove = (event) => {
            if (!this.looking || !this.lastPointer) return;
            this.look.x += (event.clientX - this.lastPointer.x) * 0.0042;
            this.look.y += (event.clientY - this.lastPointer.y) * 0.0032;
            this.lastPointer = { x: event.clientX, y: event.clientY };
        };

        this.onPointerUp = () => {
            this.looking = false;
            this.lastPointer = null;
        };

        this.onContextMenu = (event) => event.preventDefault();

        this.onWheel = (event) => {
            event.preventDefault();
            this.zoom += Math.sign(event.deltaY) * 0.12;
        };

        this.onGamepadConnected = (e) => {
            this.gamepadIndex = e.gamepad.index;
        };
        this.onGamepadDisconnected = () => {
            this.gamepadIndex = null;
        };

        window.addEventListener("keydown", this.onKeyDown, { passive: false });
        window.addEventListener("keyup", this.onKeyUp);
        window.addEventListener("blur", this.onBlur);
        window.addEventListener("gamepadconnected", this.onGamepadConnected);
        window.addEventListener("gamepaddisconnected", this.onGamepadDisconnected);
        if (target) {
            target.addEventListener("pointerdown", this.onPointerDown);
            target.addEventListener("contextmenu", this.onContextMenu);
            target.addEventListener("wheel", this.onWheel, { passive: false });
        }
        window.addEventListener("pointermove", this.onPointerMove);
        window.addEventListener("pointerup", this.onPointerUp);
    }

    dispose() {
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
        window.removeEventListener("blur", this.onBlur);
        window.removeEventListener("gamepadconnected", this.onGamepadConnected);
        window.removeEventListener("gamepaddisconnected", this.onGamepadDisconnected);
        window.removeEventListener("pointermove", this.onPointerMove);
        window.removeEventListener("pointerup", this.onPointerUp);
        if (this.target) {
            this.target.removeEventListener("pointerdown", this.onPointerDown);
            this.target.removeEventListener("contextmenu", this.onContextMenu);
            this.target.removeEventListener("wheel", this.onWheel);
        }
    }

    /* True once per press. */
    consume(action) {
        if (this.pressed.has(action)) {
            this.pressed.delete(action);
            return true;
        }
        return false;
    }

    /* Which number key was hit this frame, or 0. */
    consumeDigit() {
        const value = this.digit;
        this.digit = 0;
        return value;
    }

    held(action) {
        return this.keys.has(action);
    }

    endFrame() {
        this.pressed.clear();
    }

    setTouch(partial) {
        Object.assign(this.touch, partial);
    }

    readGamepad() {
        if (this.gamepadIndex === null || !navigator.getGamepads) return null;
        const pad = navigator.getGamepads()[this.gamepadIndex];
        if (!pad) return null;
        this.pad = pad;

        const dead = (v, zone = 0.14) => {
            const magnitude = Math.abs(v);
            if (magnitude < zone) return 0;
            /* Rescale past the deadzone so the first useful position is not a
               jump — a raw cut leaves a lurch as soon as the stick moves. */
            return Math.sign(v) * ((magnitude - zone) / (1 - zone));
        };
        const button = (index) => (pad.buttons[index] ? pad.buttons[index].value : 0);
        const down = (index) => !!(pad.buttons[index] && pad.buttons[index].pressed);

        /* Face and shoulder buttons, edge-detected so they behave like keys. */
        const edges = {
            interact: down(2) /* X / square */,
            recover: down(3) /* Y / triangle */,
            camera: down(9) /* start-adjacent stick click varies; keep both */ || down(11),
            horn: down(1) /* B / circle */,
            ability: down(5) /* right bumper */,
            roster: down(8),
            pause: down(9),
        };
        if (!this.padEdges) this.padEdges = {};
        Object.keys(edges).forEach((action) => {
            if (edges[action] && !this.padEdges[action]) this.pressed.add(action);
            if (edges[action]) this.keys.add(action);
            else if (this.padEdges[action]) this.keys.delete(action);
            this.padEdges[action] = edges[action];
        });

        return {
            steer: curve(dead(pad.axes[0] || 0)),
            throttle: button(7),
            brake: button(6),
            handbrake: down(0),
            lift: button(7) - button(6),
            pitch: dead(pad.axes[1] || 0),
            lookX: curve(dead(pad.axes[2] || 0, 0.2), 2) * 0.05,
            lookY: curve(dead(pad.axes[3] || 0, 0.2), 2) * 0.035,
            rollLeft: down(4),
        };
    }

    /* Force feedback, where the pad supports it. Silently does nothing where
       it does not, which is most of them. */
    rumble(strong, weak, duration = 120) {
        const pad = this.pad;
        if (!pad || !pad.vibrationActuator) return;
        try {
            pad.vibrationActuator.playEffect("dual-rumble", {
                duration,
                strongMagnitude: Math.max(0, Math.min(1, strong)),
                weakMagnitude: Math.max(0, Math.min(1, weak)),
            });
        } catch {
            /* Some builds expose the actuator but reject the effect type. */
        }
    }

    /* The one call the game makes each frame. */
    sample(dt = 1 / 60) {
        const pad = this.readGamepad();
        const k = this.keys;

        /* Digital intent from the keyboard, integrated into a smooth axis. */
        const steerKeys = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
        const throttleKey = k.has("up") ? 1 : 0;
        const brakeKey = k.has("down") ? 1 : 0;

        this.axisSteer = approach(
            this.axisSteer,
            steerKeys,
            steerKeys === 0 || Math.sign(steerKeys) !== Math.sign(this.axisSteer) ? STEER_RELEASE : STEER_ATTACK,
            dt
        );
        this.axisThrottle = approach(
            this.axisThrottle,
            throttleKey,
            throttleKey ? PEDAL_ATTACK : PEDAL_RELEASE,
            dt
        );
        this.axisBrake = approach(this.axisBrake, brakeKey, brakeKey ? PEDAL_ATTACK : PEDAL_RELEASE, dt);

        /* Analogue sources are already smooth and are added on top. */
        let steer = this.axisSteer + this.touch.steer;
        let throttle = this.axisThrottle + this.touch.throttle;
        let brake = this.axisBrake + this.touch.brake;
        let lift = (k.has("handbrake") ? 1 : 0) - (k.has("descend") ? 1 : 0) + this.touch.lift;

        let lookX = this.look.x;
        let lookY = this.look.y;
        this.look.x = 0;
        this.look.y = 0;

        if (pad) {
            steer += pad.steer;
            throttle += pad.throttle;
            brake += pad.brake;
            lift += pad.lift;
            lookX += pad.lookX;
            lookY += pad.lookY;
        }

        const zoom = this.zoom;
        this.zoom = 0;

        return {
            steer: clamp1(steer),
            throttle: clamp1(throttle),
            brake: clamp1(brake),
            lift: clamp1(lift),
            handbrake: k.has("handbrake") || this.touch.handbrake || (pad ? pad.handbrake : false),
            rollLeft: k.has("rollLeft") || (pad ? pad.rollLeft : false),
            lookX,
            lookY,
            looking: this.looking || Math.abs(lookX) + Math.abs(lookY) > 0.0005,
            zoom,
        };
    }
}

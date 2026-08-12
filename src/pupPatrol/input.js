/*
 * Keyboard, gamepad and thumbstick, flattened into one control state.
 *
 * Nothing downstream knows which of the three you are using, and all three can
 * be live at once — a parent on the keyboard and a kid on the touchscreen is a
 * real thing that happens.
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
    KeyM: "map",
    Tab: "roster",
    Escape: "pause",
    KeyH: "horn",
    Enter: "confirm",
};

/* Keys the page would otherwise act on: scrolling on space, focus on tab. */
const SWALLOW = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"]);

export class Input {
    constructor(target) {
        this.target = target;
        this.keys = new Set();
        this.pressed = new Set();
        this.touch = { steer: 0, throttle: 0, brake: 0, lift: 0, handbrake: false };
        this.enabled = true;
        this.gamepadIndex = null;

        this.onKeyDown = (event) => {
            if (!this.enabled) return;
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

        this.onBlur = () => this.keys.clear();

        window.addEventListener("keydown", this.onKeyDown, { passive: false });
        window.addEventListener("keyup", this.onKeyUp);
        window.addEventListener("blur", this.onBlur);
        window.addEventListener("gamepadconnected", (e) => {
            this.gamepadIndex = e.gamepad.index;
        });
        window.addEventListener("gamepaddisconnected", () => {
            this.gamepadIndex = null;
        });
    }

    dispose() {
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("keyup", this.onKeyUp);
        window.removeEventListener("blur", this.onBlur);
    }

    /* True once per press. */
    consume(action) {
        if (this.pressed.has(action)) {
            this.pressed.delete(action);
            return true;
        }
        return false;
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
        const dead = (v) => (Math.abs(v) < 0.16 ? 0 : v);
        return {
            steer: dead(pad.axes[0] || 0),
            throttle: pad.buttons[7] ? pad.buttons[7].value : 0,
            brake: pad.buttons[6] ? pad.buttons[6].value : 0,
            handbrake: !!(pad.buttons[0] && pad.buttons[0].pressed),
            lift: (pad.buttons[7] ? pad.buttons[7].value : 0) - (pad.buttons[6] ? pad.buttons[6].value : 0),
            pitch: dead(pad.axes[1] || 0),
        };
    }

    /* The one call the game makes each frame. */
    sample() {
        const pad = this.readGamepad();
        const k = this.keys;

        let steer = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
        let throttle = k.has("up") ? 1 : 0;
        let brake = k.has("down") ? 1 : 0;
        let lift = (k.has("handbrake") ? 1 : 0) - (k.has("descend") ? 1 : 0);

        steer += this.touch.steer;
        throttle += this.touch.throttle;
        brake += this.touch.brake;
        lift += this.touch.lift;

        if (pad) {
            steer += pad.steer;
            throttle += pad.throttle;
            brake += pad.brake;
            lift += pad.lift;
        }

        const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

        return {
            steer: clamp1(steer),
            throttle: clamp1(throttle),
            brake: clamp1(brake),
            lift: clamp1(lift),
            handbrake: k.has("handbrake") || this.touch.handbrake || (pad ? pad.handbrake : false),
            rollLeft: k.has("rollLeft"),
        };
    }
}

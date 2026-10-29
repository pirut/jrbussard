import AsciiWorld from "./AsciiWorld";
import { CHUNK } from "../../lib/terrain";

/* No GPU under Jest: a renderer that takes calls and draws nothing, and an
   ASCII pass with the same shape. The geometry merge comes from three's
   ES-module addons, which Jest does not load. */
jest.mock("three", () => {
    const actual = jest.requireActual("three");
    class WebGLRenderer {
        constructor() {
            this.domElement = global.document.createElement("canvas");
            this.shadowMap = {};
            this.info = { autoReset: true, reset() {}, render: { calls: 0, triangles: 0 }, memory: {} };
        }
        setPixelRatio() {}
        setSize() {}
        setClearColor() {}
        setRenderTarget() {}
        render() {}
        dispose() {}
    }
    return { ...actual, WebGLRenderer };
});
jest.mock("./asciiPass", () => {
    const actual = jest.requireActual("./asciiPass");
    class AsciiPass {
        constructor() {
            this.uniforms = {};
        }
        setSize() {}
        setShift() {}
        dispose() {}
    }
    return { ...actual, AsciiPass };
});
jest.mock("./mergeModel", () => ({ mergeModel: (model) => model, disposeMerged: () => {} }));

/*
 * The world as a page makes it: mounted in a box, fed snapshots, taken down.
 * Only the first frame is ever asked for, so the governor never measures
 * anything unless a test feeds it.
 */

beforeAll(() => {
    global.ResizeObserver = class {
        observe() {}
        disconnect() {}
    };
});

beforeEach(() => {
    window.localStorage.clear();
    jest.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function mount(options) {
    const box = document.createElement("div");
    box.getBoundingClientRect = () => ({ width: 640, height: 400, left: 0, top: 0, right: 640, bottom: 400 });
    document.body.appendChild(box);
    const world = new AsciiWorld(box, options);
    return { world, unmount: () => (world.dispose(), box.remove()) };
}

const snapshot = (over = {}) => ({ cells: [], players: [], monsters: [], ground: [], groundChunks: [], phase: "day", weather: "clear", now: 0, ...over });

describe("quality memory across visits", () => {
    it("does not walk the remembered step down on mounts that measured nothing", () => {
        window.localStorage.setItem("ascii3d:quality", "4");
        const starts = [];
        for (let i = 0; i < 4; i += 1) {
            const { world, unmount } = mount();
            starts.push(world.governor.level);
            unmount();
        }
        expect(starts).toEqual([3, 3, 3, 3]);
        expect(window.localStorage.getItem("ascii3d:quality")).toBe("4");
    });

    it("remembers where the governor settles once it has measured", () => {
        window.localStorage.setItem("ascii3d:quality", "2");
        const { world, unmount } = mount();
        expect(world.governor.level).toBe(1);
        /* Three seconds of 25 fps: a step down. */
        for (let i = 0; i < 75; i += 1) world.governor.sample(40);
        expect(world.governor.level).toBe(2);
        expect(window.localStorage.getItem("ascii3d:quality")).toBe("2");
        unmount();
    });
});

describe("puffs and reduced motion", () => {
    /* A stump and a dug tile appear, a wall goes up, then the wall comes
       down: one of each kind of work, all beside the view's middle. */
    function work(world) {
        const chunk = `${Math.floor(3 / CHUNK)}:${Math.floor(3 / CHUNK)}`;
        world.setState(snapshot({ cells: [{ x: 2, y: 3, kind: "wall" }] }));
        world.setState(
            snapshot({
                cells: [
                    { x: 2, y: 3, kind: "wall" },
                    { x: 3, y: 3, kind: "wall" },
                    { x: 4, y: 4, kind: "stump" },
                ],
                ground: [{ x: 3, y: 2, edit: -1 }],
                groundChunks: [chunk],
            }),
        );
        world.setState(snapshot({ cells: [{ x: 4, y: 4, kind: "stump" }], ground: [{ x: 3, y: 2, edit: -1 }], groundChunks: [chunk] }));
    }

    function watch(options) {
        const { world, unmount } = mount(options);
        const events = [];
        world.on((type) => events.push(type));
        work(world);
        const puffs = world.puffs.seeds.filter(Boolean).length;
        unmount();
        return { puffs, events };
    }

    it("throws puffs for work normally", () => {
        const { puffs, events } = watch();
        expect(puffs).toBeGreaterThan(0);
        expect(events).toEqual(expect.arrayContaining(["harvest", "dig", "build", "demolish"]));
    });

    it("throws none with reduced motion on, but still says what happened", () => {
        const { puffs, events } = watch({ reducedMotion: true });
        expect(puffs).toBe(0);
        expect(events).toEqual(expect.arrayContaining(["harvest", "dig", "build", "demolish"]));
    });
});

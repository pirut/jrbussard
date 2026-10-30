import * as THREE from "three";

/*
 * The isometric view, shared by the site and the Commons.
 *
 * The camera hangs high off one corner of the map and looks down at the
 * classic angle of the isometric survival games: thirty degrees down, the
 * map turned forty-five degrees, so streets run diagonally across the
 * screen and every wall shows two faces. It is orthographic, so a building
 * is the same size wherever it stands and a street keeps its width all the
 * way up the screen. `[` and `]` swing it round a quarter at a time; it
 * never turns freely.
 *
 * Walls, roofs and upper floors that stand between the camera and you are
 * cut down to stubs (see cutaway() below), the way those games open a
 * building up when you walk into it, so nothing ever hides you and you can
 * see the room you are in.
 *
 * Callers: AsciiWorld (the Commons), site3d/SiteScene.js and Diorama.js (the
 * site), and arcade/Commons.js and pages/World.js for screenToMap. Conventions:
 * yaw is radians about the vertical axis, with the camera sitting at
 * (sin yaw, ., cos yaw) from its target, so yaw 0 looks north (toward -z,
 * map -y) from the south and ISO_YAW looks north-west from the south-east.
 * World units are tiles; map (x, y) is three.js (x, z).
 *
 * Module state: CUT is a single set of uniforms shared by every material
 * that has been through cutaway(), in every scene on the page. Whoever
 * owns the frame calls aimCutaway() each frame; a scene that closes must
 * switch it off (AsciiWorld.dispose does) so the next one does not inherit
 * a cut aimed at something that no longer exists.
 */

/* Thirty degrees down (the "isometric" angle of the survival games this
   copies; true isometric is about 35.3). */
export const ISO_PITCH = Math.PI / 6;
/* Forty-five degrees: the camera at a corner of the map, so streets run
   diagonally. The four allowed yaws are ISO_YAW plus a quarter turn each
   (see isoTurn). */
export const ISO_YAW = Math.PI / 4;
/* How far back the camera hangs. Only the direction matters to an
   orthographic camera; this just keeps everything in front of it. The far
   plane in createIsoCamera is 2 * ISO_BACK + 60, so the focus sits 120
   units in and the frustum runs 180 beyond it. */
export const ISO_BACK = 120;

const scratch = new THREE.Vector3();

/* An orthographic camera with placeholder bounds: the real box is set every
   frame by placeIsoCamera. userData.iso marks it so other code can tell it
   from the first-person camera. */
export function createIsoCamera() {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, ISO_BACK * 2 + 60);
    camera.userData.iso = true;
    return camera;
}

/* Unit vector from what the camera looks at back toward the camera. */
export function isoBack(yaw, out = new THREE.Vector3()) {
    return out.set(Math.sin(yaw) * Math.cos(ISO_PITCH), Math.sin(ISO_PITCH), Math.cos(yaw) * Math.cos(ISO_PITCH));
}

/*
 * Point the camera at `focus`, showing `height` world units from the top of
 * the screen to the bottom. `aspect` is the character grid's, width over
 * height (columns * cell width over rows * cell height, which is slightly
 * different from the canvas's, since the grid is whole cells). `yaw` is
 * radians (see the header). Call snapIsoCamera afterwards if the picture
 * is to be kept on the cell grid.
 */
export function placeIsoCamera(camera, focus, yaw, height, aspect) {
    const half = height / 2;
    camera.top = half;
    camera.bottom = -half;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.position.copy(focus).addScaledVector(isoBack(yaw, scratch), ISO_BACK);
    camera.up.set(0, 1, 0);
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
}

/*
 * Slide the camera, along the screen, onto the nearest whole character
 * cell. A camera that drifts by fractions of a cell changes what every cell
 * holds every frame, and the whole picture crawls; one that moves in whole
 * cells carries the ground along unchanged, so a still landscape stays
 * still while you walk across it. Returns how many cells across and up the
 * camera now sits from the origin, for anything keyed to the ground (the
 * ASCII pass's texture), wrapped so it stays exact as a float.
 *
 * Needs the camera's matrixWorld to be current (placeIsoCamera does that).
 * `cols`/`rows` are the character grid; `out` receives the cell offset
 * (wrapped at 4096, which asciiPass's uCellShift and history.js rely on);
 * `slack`, if given, receives how far in cells the snap moved the picture
 * (in -0.5..0.5), for the pass to slide back out sub-cell.
 */
const snapRight = new THREE.Vector3();
const snapUp = new THREE.Vector3();
export function snapIsoCamera(camera, cols, rows, out = new THREE.Vector2(), slack = null) {
    const cw = (camera.right - camera.left) / cols;
    const ch = (camera.top - camera.bottom) / rows;
    if (!(cw > 0 && ch > 0)) {
        if (slack) slack.set(0, 0);
        return out.set(0, 0);
    }
    const e = camera.matrixWorld.elements;
    snapRight.set(e[0], e[1], e[2]);
    snapUp.set(e[4], e[5], e[6]);
    const sx = camera.position.dot(snapRight) / cw;
    const sy = camera.position.dot(snapUp) / ch;
    const ix = Math.round(sx);
    const iy = Math.round(sy);
    /* How far, in cells, the snap moved the picture: draw it that far back
       the other way and the scene glides a pixel at a time while the
       characters stay glued to the ground. */
    if (slack) slack.set(ix - sx, iy - sy);
    camera.position.addScaledVector(snapRight, (ix - sx) * cw).addScaledVector(snapUp, (iy - sy) * ch);
    camera.updateMatrixWorld();
    /* The wrap period must match history.js and the shader's cell-shift
       handling: a jump here would read as the whole picture moving. */
    const wrap = (n) => ((n % 4096) + 4096) % 4096;
    return out.set(wrap(ix), wrap(iy));
}

/*
 * A direction on screen, as a direction on the map. `sx` is right, `sy`
 * down, as the keys give them; the answer is in map units (x east, y
 * south), unit length, or [0, 0] for no direction at all. Up the screen is
 * straight away from the camera, so with the default turn W walks
 * north-west and W with D walks due north.
 */
export function screenToMap(yaw, sx, sy) {
    /* (fx, fy): screen-up on the map, away from the camera. (rx, ry):
       screen-right. They are the camera's axes flattened onto the ground. */
    const fx = -Math.sin(yaw);
    const fy = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const ry = -Math.sin(yaw);
    const x = rx * sx - fx * sy;
    const y = ry * sx - fy * sy;
    const length = Math.hypot(x, y);
    return length < 1e-6 ? [0, 0] : [x / length, y / length];
}

/* The nearest of the four isometric turns to a yaw, as 0–3 (0 is ISO_YAW,
   each step a quarter turn the way yaw increases). The same count that
   controls.js's TURN_UP is indexed by. */
export function isoTurn(yaw) {
    const q = Math.round((yaw - ISO_YAW) / (Math.PI / 2));
    return ((q % 4) + 4) % 4;
}

/* ── Cutaway ──────────────────────────────────────────────────────────── */

/*
 * Uniforms every cut-away material shares. Each frame the scene says where
 * you stand and which way the camera looks; any fragment of the world that
 * lies on the camera's side of you, inside an oval round you on screen,
 * and higher than the cut, is thrown away. What is left of a wall in front
 * of you is a stub at knee height, and you can see in.
 */
export const CUT = {
    /* 1 while the cut is active, 0 for none (set by aimCutaway). */
    uCutOn: { value: 0 },
    /* Where you stand: your feet. */
    uCutAt: { value: new THREE.Vector3() },
    /* Unit vectors: toward the camera along the ground, and the screen's
       right and up. */
    uCutBack: { value: new THREE.Vector3(0, 0, 1) },
    uCutRight: { value: new THREE.Vector3(1, 0, 0) },
    uCutUp: { value: new THREE.Vector3(0, 1, 0) },
    /* Half the oval's width and height, in world units on screen. */
    uCutSize: { value: new THREE.Vector2(5, 4) },
    /* Height above your feet that walls in front are cut down to, and the
       storey height the cut steps by. */
    uCutStub: { value: 0.45 },
    uCutStorey: { value: 0.9 },
};

/* Aim the cut at someone standing at `at` (a Vector3, their feet), seen by
   `camera` (its matrixWorld must be current). `width`/`height` are the oval's
   half extents in world units on screen; `stub` is how tall, above `at`,
   a cut wall is left standing. `on: false` turns the cut off for everything
   (first person does this; the orbit view also turns it off). Call once per frame, after the
   camera has been placed and snapped. */
export function aimCutaway(camera, at, { on = true, width = 5, height = 4.5, stub = 0.45 } = {}) {
    CUT.uCutOn.value = on ? 1 : 0;
    CUT.uCutAt.value.copy(at);
    const e = camera.matrixWorld.elements;
    CUT.uCutRight.value.set(e[0], e[1], e[2]).normalize();
    CUT.uCutUp.value.set(e[4], e[5], e[6]).normalize();
    /* Level: what counts is whether something stands nearer the camera
       than you on the ground, not how high it is. */
    CUT.uCutBack.value.set(e[8], 0, e[10]).normalize();
    CUT.uCutSize.value.set(width, height);
    CUT.uCutStub.value = stub;
}

/*
 * Teach a material to be cut away. Chains onto whatever onBeforeCompile it
 * already has (the grass sways in one). Figures are never passed through
 * this: people are not cut in half. (asFigure() clones materials, and a
 * clone does not carry the patch because three.js's Material.copy leaves
 * onBeforeCompile behind.)
 *
 * Any material passed in that has its own onBeforeCompile must also set its
 * own customProgramCacheKey (the grass and sea do): the key made below
 * only prefixes the existing one, and the default key is derived from the
 * function source.
 */
export function cutaway(mat) {
    if (mat.userData.cutaway) return mat;
    mat.userData.cutaway = true;
    const before = mat.onBeforeCompile;
    const key = mat.customProgramCacheKey;
    mat.onBeforeCompile = (shader, renderer) => {
        before.call(mat, shader, renderer);
        Object.assign(shader.uniforms, CUT);
        /* The world position of each fragment, with instancing applied
           (an InstancedMesh is placed by instanceMatrix on top of the model
           matrix). The fragment stage below compares it against the
           uniforms. */
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vCutWorld;")
            .replace(
                "#include <project_vertex>",
                `#include <project_vertex>
                vec4 cutLocal = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                    cutLocal = instanceMatrix * cutLocal;
                #endif
                vCutWorld = (modelMatrix * cutLocal).xyz;`,
            );
        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                `#include <common>
                varying vec3 vCutWorld;
                uniform float uCutOn;
                uniform vec3 uCutAt;
                uniform vec3 uCutBack;
                uniform vec3 uCutRight;
                uniform vec3 uCutUp;
                uniform vec2 uCutSize;
                uniform float uCutStub;
                uniform float uCutStorey;`,
            )
            .replace(
                "#include <clipping_planes_fragment>",
                `#include <clipping_planes_fragment>
                /* Measured by whole tiles and whole storeys, so the cut
                   follows the city's own lines: a building loses its
                   upper floors, not a round bite out of its face. The
                   small offset keeps a face that sits exactly on a tile
                   edge on one side of it. */
                vec3 cutQ = vec3(floor(vCutWorld.x + 0.513), floor(vCutWorld.y / uCutStorey + 0.02) * uCutStorey, floor(vCutWorld.z + 0.513));
                if (uCutOn > 0.5 && cutQ.y >= uCutAt.y + uCutStub) {
                    vec3 cutV = cutQ - uCutAt;
                    /* Only what stands on the camera's side of you, along
                       the ground. A little slack, so the wall at your back
                       stays whole however tall it is. */
                    if (dot(cutV.xz, uCutBack.xz) > 0.45) {
                        /* The oval sits round your middle, not your feet. */
                        vec2 cutS = vec2(dot(cutV, uCutRight), dot(cutV, uCutUp) - 0.9) / uCutSize;
                        if (dot(cutS, cutS) < 1.0) discard;
                    }
                }`,
            );
    };
    mat.customProgramCacheKey = () => `cut|${key.call(mat)}`;
    mat.needsUpdate = true;
    return mat;
}

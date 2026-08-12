/*
 * Adventure Bay: the island itself.
 *
 * Everything downstream — the terrain mesh, wheel raycasts, where a tree is
 * allowed to grow, where a mission may drop a crate — reads the world through
 * this module. There is exactly one height function and one surface function,
 * so the mesh you see and the ground the wheels feel can never drift apart.
 *
 * Roads are the interesting part. They are splines laid over the raw terrain;
 * a rasterisation pass stamps each one into a coarse grid holding "how much
 * road is here" and "what height does the road want". The final height is the
 * raw terrain blended toward the road height by that influence, which cuts the
 * uphill side and fills the downhill side for free. Drive the mountain and you
 * are driving through a notch someone cut, not over a painted stripe.
 */

import { fbm2, ridged2, clamp, smoothstep, lerp, makeRandom } from "./noise";

export const WORLD_HALF = 460; /* island lives inside +/- this, in metres */
export const SEA_LEVEL = 0;

/* Coarse grid the road stamps live in. 3 m cells over the whole world. */
const GRID_CELL = 3;
const GRID_SIZE = Math.ceil((WORLD_HALF * 2) / GRID_CELL) + 1;

export const SURFACE = {
    GRASS: 0,
    ROAD: 1,
    SAND: 2,
    ROCK: 3,
    SNOW: 4,
    WATER: 5,
};

/* Grip and dust colour per surface. Tarmac holds, sand slides and sprays. */
export const SURFACE_INFO = {
    [SURFACE.GRASS]: { grip: 0.82, roll: 1.5, dust: 0x9fbd6a, dustRate: 0.5 },
    [SURFACE.ROAD]: { grip: 1.0, roll: 0.7, dust: 0xb9b2a6, dustRate: 0.12 },
    [SURFACE.SAND]: { grip: 0.62, roll: 3.2, dust: 0xe8d7a8, dustRate: 1.0 },
    [SURFACE.ROCK]: { grip: 0.9, roll: 1.8, dust: 0xa79a8e, dustRate: 0.35 },
    [SURFACE.SNOW]: { grip: 0.5, roll: 2.4, dust: 0xffffff, dustRate: 0.9 },
    [SURFACE.WATER]: { grip: 0.28, roll: 6.0, dust: 0xcfeaf5, dustRate: 1.0 },
};

/* Far enough from the coast that the island falloff does not bite chunks out
   of the flank the Summit Trail has to cross. */
const MOUNTAIN = { x: -168, z: -176, radius: 212, height: 88 };
const TOWN = { x: 0, z: 24, radius: 118, height: 13.5 };

/* Adventure Bay proper. Carving it as a disc of "subtract 46 m" put a lake
   across the whole south-east and drowned three roads; pulling the *coastline*
   inland over a wedge of angles instead gives a bay that is, by construction,
   open to the sea and impossible to sink the interior with. */
const BAY = { angle: 1.16, width: 0.27, reach: 92 };

/* Walk out from the middle of the island on a bearing until the ground goes
   under, bisect the waterline, then step back inland. Coastal landmarks are
   placed this way rather than by hand: the shoreline is a noise field, and
   every coordinate I guessed at ended up in the sea. */
function shorePoint(angle, inland = 16) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const groundAt = (r) => rawHeight(cos * r, sin * r);

    let r = 140;
    while (r < 480 && groundAt(r) > 0.8) r += 5;
    let lo = r - 5;
    let hi = r;
    for (let i = 0; i < 22; i += 1) {
        const mid = (lo + hi) * 0.5;
        if (groundAt(mid) > 0.8) lo = mid;
        else hi = mid;
    }
    const rr = Math.max(0, lo - inland);
    return { x: cos * rr, z: sin * rr };
}

/* A quay and a beach need somewhere flat at the water's edge, which walking a
   single ray outward will not find — it stops at the first waterline, and on
   this coast that is as likely to be the top of a bluff. Sweep a fan of
   bearings instead and score candidates on being low, level, and next to open
   water, preferring the ones nearest the bearing asked for. */
function findCoastalFlat(preferred, spread = 0.55) {
    let best = null;
    for (let a = preferred - spread; a <= preferred + spread; a += 0.03) {
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        for (let r = 130; r < 462; r += 5) {
            const x = cos * r;
            const z = sin * r;
            const h = rawHeight(x, z);
            if (h < 1.4 || h > 6.5) continue;

            let openWater = false;
            for (let k = 10; k <= 70; k += 10) {
                if (rawHeight(cos * (r + k), sin * (r + k)) < -2) {
                    openWater = true;
                    break;
                }
            }
            if (!openWater) continue;

            const slope =
                Math.hypot(rawHeight(x + 3, z) - rawHeight(x - 3, z), rawHeight(x, z + 3) - rawHeight(x, z - 3)) / 6;
            if (slope > 0.3) continue;

            const score = Math.abs(a - preferred) * 70 + slope * 120 + Math.abs(h - 3.4) * 5;
            if (!best || score < best.score) best = { x, z, score };
        }
    }
    return best ? { x: best.x, z: best.z } : shorePoint(preferred, 16);
}

const HARBOUR = findCoastalFlat(BAY.angle, 0.45);
const BEACH = findCoastalFlat(BAY.angle + 0.5, 0.4);
const LIGHTHOUSE = shorePoint(0.5, 7);

/* Pull a coastal point back toward the middle of the island. */
function inlandOf(p, metres) {
    const len = Math.hypot(p.x, p.z) || 1;
    const k = 1 - metres / len;
    return { x: p.x * k, z: p.z * k };
}

/* Far enough back that the ramp down to the sand is a gentle descent rather
   than something the grade limiter has to refuse. */
const BEACH_TURNOFF = inlandOf(BEACH, 96);

/* Named places. Missions, signposts and the map all draw from this list. */
export const PLACES = [
    { id: "lookout", name: "The Lookout", x: 66, z: 134, kind: "hq" },
    { id: "townsquare", name: "Town Square", x: 0, z: 24, kind: "town" },
    { id: "cityhall", name: "City Hall", x: -44, z: 8, kind: "town" },
    { id: "harbour", name: "The Harbour", ...HARBOUR, kind: "coast" },
    { id: "lighthouse", name: "Lighthouse Point", ...LIGHTHOUSE, kind: "coast" },
    { id: "beach", name: "Sandy Beach", ...BEACH, kind: "coast" },
    { id: "farm", name: "Farmer Al's Farm", x: 258, z: -74, kind: "farm" },
    { id: "forest", name: "Whispering Woods", x: -66, z: -244, kind: "forest" },
    { id: "lodge", name: "Jake's Lodge", x: -201, z: -78, kind: "mountain" },
    { id: "summit", name: "The Summit", x: -168, z: -176, kind: "mountain" },
    { id: "quarry", name: "The Quarry", x: -276, z: 108, kind: "works" },
    { id: "bridge", name: "Turtle Creek Bridge", x: 132, z: 126, kind: "road" },
];

export function placeById(id) {
    return PLACES.find((p) => p.id === id) || PLACES[0];
}

/* ------------------------------------------------------------------ *
 * Raw terrain, before any road touches it
 * ------------------------------------------------------------------ */

function rawHeight(x, z) {
    /* Broad rolling shape. */
    let h = fbm2(x * 0.0035, z * 0.0035, 11, 4) * 24;
    h += fbm2(x * 0.0125, z * 0.0125, 23, 3) * 7.5;
    h += fbm2(x * 0.052, z * 0.052, 37, 2) * 1.3;
    h += 17;

    /* The mountain, with ridges running down its flanks. */
    const md = Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z);
    const mt = clamp(1 - md / MOUNTAIN.radius, 0, 1);
    if (mt > 0) {
        const cone = Math.pow(mt, 1.65) * MOUNTAIN.height;
        /* Ridges fade out at the very top so the summit is a place you can
           park and look out from, not a spike. */
        const ridge = ridged2(x * 0.0135, z * 0.0135, 71, 4) * 10 * Math.pow(mt, 0.8) * smoothstep(16, 46, md);
        h += cone + ridge;
    }

    /* Island falloff: past ~300 m the ground walks into the sea. */
    const d = Math.hypot(x, z);
    let coast = fbm2(x * 0.0042, z * 0.0042, 91, 3) * 62;

    /* The bay, as a wedge of coastline pulled inland. */
    let da = Math.atan2(z, x) - BAY.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    coast -= BAY.reach * Math.exp((-da * da) / (2 * BAY.width * BAY.width));

    /* Wide and shallow. A smoothstep is steepest exactly halfway through,
       which is roughly where the waterline lands, so a narrow falloff hands
       you a cliff no amount of beach-flattening afterwards can fix. */
    h -= smoothstep(215 + coast, 675 + coast, d) * 152;

    /* Turtle Creek, a shallow channel running from the hills into the bay. */
    const creek = Math.abs(z - 96 - Math.sin(x * 0.021) * 26 - x * 0.22);
    h -= (1 - smoothstep(0, 26, creek)) * 9 * smoothstep(30, 120, x);

    /* Beaches. Squashing the band just above the waterline is what turns a
       coast into sand you can drive on; left alone the island falloff arrives
       at the sea as a 15 m bank. Done before the town is levelled so the town
       keeps the height it asked for. */
    /* Squashing this band is what makes the coast a beach you can drive along
       rather than a bank you fall off. The numbers are a balance: too gentle
       and the shore is a kerb, too strong and it flattens the entire low half
       of the island into a car park — at 22/2.8 ground that was 8 m came out
       at 1.5 m and the woods had nowhere above the tideline to grow. */
    const BEACH_TOP = 12;
    if (h > 0 && h < BEACH_TOP) h = BEACH_TOP * Math.pow(h / BEACH_TOP, 1.8);
    /* Shallow shelf offshore, then it falls away. */
    if (h < 0) h = -Math.sqrt(-h * 3.4) * 2.2;

    /* Flatten the town into a bowl so the streets are level. */
    const td = Math.hypot(x - TOWN.x, z - TOWN.z);
    h = lerp(h, TOWN.height, (1 - smoothstep(TOWN.radius * 0.45, TOWN.radius, td)) * 0.94);

    return h;
}

/* ------------------------------------------------------------------ *
 * Roads
 * ------------------------------------------------------------------ */

function catmullRom(points, samplesPerSpan) {
    const out = [];
    const n = points.length;
    for (let i = 0; i < n - 1; i += 1) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(n - 1, i + 2)];
        for (let s = 0; s < samplesPerSpan; s += 1) {
            const t = s / samplesPerSpan;
            const t2 = t * t;
            const t3 = t2 * t;
            out.push([
                0.5 *
                    (2 * p1[0] +
                        (-p0[0] + p2[0]) * t +
                        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 *
                    (2 * p1[1] +
                        (-p0[1] + p2[1]) * t +
                        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
            ]);
        }
    }
    out.push(points[n - 1]);
    return out;
}

/* The road up the mountain is a spiral rather than switchbacks: hairpins that
   double back sit close enough that their flattening discs merge and shave the
   whole face off. A spiral keeps each pass a comfortable distance from the one
   below it. */
/* Turns are spaced so that neighbouring passes never fall inside each other's
   flattening reach — when they do, the two cuts merge and take the whole face
   of the mountain with them. */
function mountainSpiral() {
    const pts = [];
    const turns = 1.55;
    const steps = 240;
    /* Begins at Jake's Lodge, where the Quarry Road gives out. */
    const startAngle = 1.88;
    for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const radius = lerp(110, 20, t);
        const angle = startAngle + t * turns * Math.PI * 2;
        pts.push([MOUNTAIN.x + Math.cos(angle) * radius, MOUNTAIN.z + Math.sin(angle) * radius * 0.94]);
    }
    /* A short spur off the last bend onto the summit itself. */
    pts.push([MOUNTAIN.x, MOUNTAIN.z]);
    return pts;
}

const ROAD_DEFS = [
    {
        id: "main",
        name: "Main Street",
        width: 11,
        points: [
            [-168, 96],
            [-96, 62],
            [-40, 34],
            [0, 24],
            [58, 16],
            [118, 20],
        ],
    },
    {
        /* The long way round: out of town, past the Lookout, along the water
           and back up the west side. With Main Street it closes a ring, which
           is what makes the island feel drivable rather than a set of spurs. */
        id: "bay",
        name: "Bay Road",
        width: 10,
        points: [
            [118, 20],
            [152, 60],
            [148, 106],
            [116, 134],
            [98, 156],
            [HARBOUR.x + 2, HARBOUR.z - 4],
            [HARBOUR.x - 24, HARBOUR.z + 6],
            [BEACH_TURNOFF.x, BEACH_TURNOFF.z],
            [-80, 180],
            [-124, 158],
            [-152, 122],
            [-168, 96],
        ],
    },
    {
        id: "farm",
        name: "Farm Lane",
        width: 8.5,
        points: [
            [118, 20],
            [176, -8],
            [222, -44],
            [258, -74],
            [300, -30],
            [LIGHTHOUSE.x + 26, LIGHTHOUSE.z - 60],
            [LIGHTHOUSE.x, LIGHTHOUSE.z],
        ],
    },
    {
        id: "forest",
        name: "Forest Road",
        width: 9,
        points: [
            [0, 24],
            [16, -46],
            [4, -122],
            [-38, -192],
            [-66, -244],
            [-112, -272],
        ],
    },
    {
        id: "west",
        name: "Quarry Road",
        width: 9,
        points: [
            [-168, 96],
            [-232, 112],
            [-276, 108],
            [-306, 46],
            [-300, -16],
            [-262, -56],
            [-201, -78],
        ],
    },
    {
        id: "summit",
        name: "Summit Trail",
        /* Hugs the ground more closely than the lowland roads: a mountain track
           follows the contour instead of bridging across it. */
        width: 7,
        blend: 1.3,
        blur: 6,
        maxGrade: 0.17,
        points: mountainSpiral(),
        raw: true,
    },
    {
        id: "beach",
        name: "Beach Access",
        width: 7.5,
        blur: 4,
        maxGrade: 0.2,
        points: [
            [BEACH_TURNOFF.x, BEACH_TURNOFF.z],
            [(BEACH_TURNOFF.x + BEACH.x) * 0.5 + 8, (BEACH_TURNOFF.z + BEACH.z) * 0.5],
            [BEACH.x, BEACH.z],
            [BEACH.x * 1.06, BEACH.z * 1.06],
        ],
    },
];

/* ------------------------------------------------------------------ *
 * Build: rasterise roads into the influence grid
 * ------------------------------------------------------------------ */

const RESAMPLE = 2.5; /* metres between centreline samples */

const influence = new Float32Array(GRID_SIZE * GRID_SIZE);
const roadY = new Float32Array(GRID_SIZE * GRID_SIZE);
export const roads = [];
let built = false;

function gridIndex(gx, gz) {
    return gz * GRID_SIZE + gx;
}

/* Box blur via prefix sums. Three passes approximate a Gaussian of sigma ~=
   radius, which is what a road profile wants: ignore every lump the hillside
   has and keep only the broad rise.
 *
 * The ends are padded by reflecting *through* the endpoint (2*h0 - h[j]) rather
 * than repeating it. Repeating drags the first sample toward the interior, and
 * on a climbing road the interior is uphill — the Summit Trail came out
 * starting 19 m above the road it joins, leaving a cliff at the junction.
 * Odd reflection preserves a straight run exactly, so roads still meet where
 * their shared endpoint says they should. */
function blurHeights(heights, radius, passes) {
    const n = heights.length;
    if (n < 3) return;
    const ext = new Float64Array(n + radius * 2);
    const prefix = new Float64Array(ext.length + 1);

    for (let p = 0; p < passes; p += 1) {
        for (let i = 0; i < n; i += 1) ext[radius + i] = heights[i];
        for (let j = 1; j <= radius; j += 1) {
            ext[radius - j] = 2 * heights[0] - heights[Math.min(n - 1, j)];
            ext[radius + n - 1 + j] = 2 * heights[n - 1] - heights[Math.max(0, n - 1 - j)];
        }
        for (let i = 0; i < ext.length; i += 1) prefix[i + 1] = prefix[i] + ext[i];
        for (let i = 0; i < n; i += 1) {
            heights[i] = (prefix[i + radius * 2 + 1] - prefix[i]) / (radius * 2 + 1);
        }
    }
}

/* Hard ceiling on how fast a road may climb. Sweeping alternately from both
   ends converges on a profile that respects the limit without pinning itself
   to whichever end was visited first. Steps use the real distance between
   samples: resampling leaves the last pair closer together than the rest, and
   a fixed step there would wave through a cliff. */
function limitGrade(heights, path, maxGrade) {
    const n = heights.length;
    const span = new Float32Array(n);
    for (let i = 1; i < n; i += 1) {
        span[i] = Math.max(0.05, Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    }
    for (let sweep = 0; sweep < 5; sweep += 1) {
        for (let i = 1; i < n; i += 1) {
            const step = span[i] * maxGrade;
            if (heights[i] > heights[i - 1] + step) heights[i] = heights[i - 1] + step;
            else if (heights[i] < heights[i - 1] - step) heights[i] = heights[i - 1] - step;
        }
        for (let i = n - 2; i >= 0; i -= 1) {
            const step = span[i + 1] * maxGrade;
            if (heights[i] > heights[i + 1] + step) heights[i] = heights[i + 1] + step;
            else if (heights[i] < heights[i + 1] - step) heights[i] = heights[i + 1] - step;
        }
    }
}

/* Two roads that meet reach the shared corner with independently smoothed
   profiles, and they disagree — the Summit Trail arrived 13 m above the Quarry
   Road it grows out of. Pull every endpoint that shares a corner to a common
   height, then fade the correction out along the road so the grade stays sane.
   Interior crossings are handled later by relaxing the grid; this is only for
   roads that genuinely end on one another. */
const JUNCTION_RADIUS = 16;
const JUNCTION_FADE = 34; /* samples over which the correction dies away */

function reconcileJunctions(builtRoads) {
    const ends = [];
    builtRoads.forEach((road, r) => {
        ends.push({ r, i: 0, x: road.path[0][0], z: road.path[0][1] });
        const last = road.path.length - 1;
        ends.push({ r, i: last, x: road.path[last][0], z: road.path[last][1] });
    });

    const claimed = new Array(ends.length).fill(false);
    for (let a = 0; a < ends.length; a += 1) {
        if (claimed[a]) continue;
        const group = [ends[a]];
        claimed[a] = true;
        for (let b = a + 1; b < ends.length; b += 1) {
            if (claimed[b] || ends[b].r === ends[a].r) continue;
            if (Math.hypot(ends[b].x - ends[a].x, ends[b].z - ends[a].z) > JUNCTION_RADIUS) continue;
            group.push(ends[b]);
            claimed[b] = true;
        }
        if (group.length < 2) continue;

        let target = 0;
        group.forEach((e) => {
            target += builtRoads[e.r].heights[e.i];
        });
        target /= group.length;

        group.forEach((e) => {
            const { heights } = builtRoads[e.r];
            const delta = target - heights[e.i];
            const n = heights.length;
            const fade = Math.min(JUNCTION_FADE, n - 1);
            for (let k = 0; k <= fade; k += 1) {
                const idx = e.i === 0 ? k : e.i - k;
                if (idx < 0 || idx >= n) break;
                heights[idx] += delta * (1 - smoothstep(0, fade, k));
            }
        });
    }
}

function buildRoads() {
    /* Weighted accumulation rather than "nearest wins": at a junction two
       roads overlap and a max() would leave a step between them. */
    const sumW = new Float32Array(GRID_SIZE * GRID_SIZE);
    const sumWY = new Float32Array(GRID_SIZE * GRID_SIZE);

    /* Phase one: every road gets its own profile. */
    const drafted = ROAD_DEFS.map((def) => {
        const dense = def.raw ? def.points : catmullRom(def.points, 14);

        /* Resample to an even ~2.5 m spacing so stamping is uniform. */
        const path = [];
        let carry = 0;
        for (let i = 0; i < dense.length - 1; i += 1) {
            const [x0, z0] = dense[i];
            const [x1, z1] = dense[i + 1];
            const seg = Math.hypot(x1 - x0, z1 - z0);
            if (seg < 1e-4) continue;
            while (carry < seg) {
                const t = carry / seg;
                path.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
                carry += RESAMPLE;
            }
            carry -= seg;
        }
        path.push(dense[dense.length - 1]);

        /* Trim back to the waterline. Roads are drawn on a map by hand and the
           coast is a noise field; rather than clamping a drowned end up to
           1.4 m — which builds a 30 m causeway out to sea — just stop the road
           where the land stops. */
        while (path.length > 2 && rawHeight(path[0][0], path[0][1]) < 1.1) path.shift();
        while (path.length > 2 && rawHeight(path[path.length - 1][0], path[path.length - 1][1]) < 1.1) path.pop();

        /* Follow the land, but smoothed — a road takes a gentler line than the
           hillside it crosses. */
        const heights = new Float32Array(path.length);
        for (let i = 0; i < path.length; i += 1) {
            heights[i] = Math.max(1.4, rawHeight(path[i][0], path[i][1]));
        }
        blurHeights(heights, def.blur || 11, 3);
        limitGrade(heights, path, def.maxGrade || 0.14);

        return { def, path, heights };
    });

    /* Phase two: make roads that end on each other agree at the corner. */
    reconcileJunctions(drafted);

    /* Phase three: stamp them into the grid. */
    drafted.forEach(({ def, path, heights }) => {
        limitGrade(heights, path, (def.maxGrade || 0.14) * 1.35);

        const halfWidth = def.width * 0.5;
        const blend = def.width * (def.blend || 1.9);
        const reach = halfWidth + blend;

        for (let i = 0; i < path.length; i += 1) {
            const [px, pz] = path[i];
            const py = heights[i];
            const gx0 = Math.max(0, Math.floor((px - reach + WORLD_HALF) / GRID_CELL));
            const gx1 = Math.min(GRID_SIZE - 1, Math.ceil((px + reach + WORLD_HALF) / GRID_CELL));
            const gz0 = Math.max(0, Math.floor((pz - reach + WORLD_HALF) / GRID_CELL));
            const gz1 = Math.min(GRID_SIZE - 1, Math.ceil((pz + reach + WORLD_HALF) / GRID_CELL));

            for (let gz = gz0; gz <= gz1; gz += 1) {
                const wz = gz * GRID_CELL - WORLD_HALF;
                for (let gx = gx0; gx <= gx1; gx += 1) {
                    const wx = gx * GRID_CELL - WORLD_HALF;
                    const d = Math.hypot(wx - px, wz - pz);
                    if (d > reach) continue;
                    const w = 1 - smoothstep(halfWidth, reach, d);
                    if (w <= 0.001) continue;
                    const idx = gridIndex(gx, gz);
                    if (w > influence[idx]) influence[idx] = w;
                    const ww = w * w;
                    sumW[idx] += ww;
                    sumWY[idx] += ww * py;
                }
            }
        }

        /* Keep the centreline for the road ribbon mesh and for AI driving. */
        roads.push({ id: def.id, name: def.name, width: def.width, path, heights });
    });

    for (let i = 0; i < roadY.length; i += 1) {
        roadY[i] = sumW[i] > 0 ? sumWY[i] / sumW[i] : 0;
    }

    /* Where two roads cross they arrive at slightly different heights and the
       weighted average leaves a step. A few relaxation passes over occupied
       cells only turns that step into a ramp. */
    const relaxed = new Float32Array(roadY.length);
    for (let pass = 0; pass < 6; pass += 1) {
        relaxed.set(roadY);
        for (let gz = 1; gz < GRID_SIZE - 1; gz += 1) {
            for (let gx = 1; gx < GRID_SIZE - 1; gx += 1) {
                const i = gridIndex(gx, gz);
                if (influence[i] <= 0.001) continue;
                let sum = roadY[i];
                let count = 1;
                for (let d = 0; d < 4; d += 1) {
                    const j = i + (d === 0 ? 1 : d === 1 ? -1 : d === 2 ? GRID_SIZE : -GRID_SIZE);
                    if (influence[j] > 0.001) {
                        sum += roadY[j];
                        count += 1;
                    }
                }
                relaxed[i] = sum / count;
            }
        }
        roadY.set(relaxed);
    }

    built = true;
}

function ensureBuilt() {
    if (!built) buildRoads();
}

/* Bilinear read of the road grid. */
function sampleRoad(x, z, out) {
    const fx = (x + WORLD_HALF) / GRID_CELL;
    const fz = (z + WORLD_HALF) / GRID_CELL;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    if (x0 < 0 || z0 < 0 || x0 >= GRID_SIZE - 1 || z0 >= GRID_SIZE - 1) {
        out.influence = 0;
        out.y = 0;
        return out;
    }
    const tx = fx - x0;
    const tz = fz - z0;
    const i00 = gridIndex(x0, z0);
    const i10 = i00 + 1;
    const i01 = i00 + GRID_SIZE;
    const i11 = i01 + 1;

    const a = lerp(influence[i00], influence[i10], tx);
    const b = lerp(influence[i01], influence[i11], tx);
    out.influence = lerp(a, b, tz);

    /* Cells with no road carry no height; fall back to their neighbours so the
       edge of the ribbon does not get dragged toward zero. */
    let wsum = 0;
    let ysum = 0;
    const acc = (idx, w) => {
        if (influence[idx] > 0.001) {
            wsum += w;
            ysum += roadY[idx] * w;
        }
    };
    acc(i00, (1 - tx) * (1 - tz));
    acc(i10, tx * (1 - tz));
    acc(i01, (1 - tx) * tz);
    acc(i11, tx * tz);
    out.y = wsum > 0 ? ysum / wsum : 0;
    return out;
}

const roadProbe = { influence: 0, y: 0 };

/* ------------------------------------------------------------------ *
 * Public sampling
 * ------------------------------------------------------------------ */

export function heightAt(x, z) {
    ensureBuilt();
    const base = rawHeight(x, z);
    const r = sampleRoad(x, z, roadProbe);
    if (r.influence <= 0.001) return base;
    /* Ease the blend so the shoulder meets the verge without a crease. */
    const t = r.influence * r.influence * (3 - 2 * r.influence);
    return lerp(base, r.y, t);
}

export function roadInfluenceAt(x, z) {
    ensureBuilt();
    return sampleRoad(x, z, roadProbe).influence;
}

const NORMAL_STEP = 1.1;
export function normalAt(x, z, out) {
    const hL = heightAt(x - NORMAL_STEP, z);
    const hR = heightAt(x + NORMAL_STEP, z);
    const hD = heightAt(x, z - NORMAL_STEP);
    const hU = heightAt(x, z + NORMAL_STEP);
    const nx = hL - hR;
    const ny = 2 * NORMAL_STEP;
    const nz = hD - hU;
    const inv = 1 / Math.hypot(nx, ny, nz);
    out.set(nx * inv, ny * inv, nz * inv);
    return out;
}

export function slopeAt(x, z) {
    const hL = heightAt(x - NORMAL_STEP, z);
    const hR = heightAt(x + NORMAL_STEP, z);
    const hD = heightAt(x, z - NORMAL_STEP);
    const hU = heightAt(x, z + NORMAL_STEP);
    return Math.hypot(hR - hL, hU - hD) / (2 * NORMAL_STEP);
}

export function surfaceAt(x, z) {
    ensureBuilt();
    const h = heightAt(x, z);
    if (h < SEA_LEVEL - 0.15) return SURFACE.WATER;
    if (sampleRoad(x, z, roadProbe).influence > 0.52) return SURFACE.ROAD;
    if (h < 3.6) return SURFACE.SAND;
    if (h > 56 && slopeAt(x, z) < 0.95) return SURFACE.SNOW;
    if (slopeAt(x, z) > 0.62) return SURFACE.ROCK;
    return SURFACE.GRASS;
}

export function isLand(x, z, margin = 1.2) {
    return heightAt(x, z) > SEA_LEVEL + margin;
}

/* ------------------------------------------------------------------ *
 * Picking spots for missions and props
 * ------------------------------------------------------------------ */

/* A point on the road network, `t` of the way along a random road. */
export function randomRoadPoint(random = Math.random, minFromOrigin = 0) {
    ensureBuilt();
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const road = roads[Math.floor(random() * roads.length)];
        const i = Math.floor(random() * road.path.length);
        const [x, z] = road.path[i];
        if (Math.hypot(x, z) < minFromOrigin) continue;
        return { x, z, y: heightAt(x, z) };
    }
    const road = roads[0];
    const [x, z] = road.path[0];
    return { x, z, y: heightAt(x, z) };
}

/* Somewhere you could stand: on land, not absurdly steep, off the tarmac. */
export function randomLandPoint(random = Math.random, opts = {}) {
    ensureBuilt();
    const { near = null, radius = 220, offRoad = true, maxSlope = 0.55, minHeight = 1.6 } = opts;
    for (let attempt = 0; attempt < 90; attempt += 1) {
        let x;
        let z;
        if (near) {
            const a = random() * Math.PI * 2;
            const r = Math.sqrt(random()) * radius;
            x = near.x + Math.cos(a) * r;
            z = near.z + Math.sin(a) * r;
        } else {
            x = (random() * 2 - 1) * WORLD_HALF * 0.82;
            z = (random() * 2 - 1) * WORLD_HALF * 0.82;
        }
        const h = heightAt(x, z);
        if (h < minHeight) continue;
        if (slopeAt(x, z) > maxSlope) continue;
        if (offRoad && roadInfluenceAt(x, z) > 0.25) continue;
        return { x, z, y: h };
    }
    const fallback = PLACES[1];
    return { x: fallback.x, z: fallback.z, y: heightAt(fallback.x, fallback.z) };
}

/* ------------------------------------------------------------------ *
 * Scatter: trees, rocks, and the rest of the set dressing
 * ------------------------------------------------------------------ */

export function scatterProps() {
    ensureBuilt();
    const random = makeRandom(20260812);
    const out = { trees: [], pines: [], palms: [], rocks: [], bushes: [], grass: [] };

    const push = (list, x, z, scale, rot) => list.push({ x, z, y: heightAt(x, z), scale, rot });

    for (let i = 0; i < 60000; i += 1) {
        const x = (random() * 2 - 1) * WORLD_HALF;
        const z = (random() * 2 - 1) * WORLD_HALF;
        const h = heightAt(x, z);
        if (h < 1.2) continue;
        const slope = slopeAt(x, z);
        if (slope > 0.78) continue;
        if (roadInfluenceAt(x, z) > 0.18) continue;

        /* Woodland mass: sample a noise field so trees clump into stands with
           clearings between, instead of an even carpet. */
        const density = fbm2(x * 0.006, z * 0.006, 301, 3);
        const townDist = Math.hypot(x - TOWN.x, z - TOWN.z);
        const nearTown = townDist < 130 ? 0.75 : 0;
        const roll = random();

        if (h > 58) {
            if (roll < 0.16 && slope < 0.6) push(out.rocks, x, z, 0.7 + random() * 1.5, random() * 6.28);
            else if (roll < 0.22) push(out.pines, x, z, 0.55 + random() * 0.3, random() * 6.28);
            continue;
        }
        if (h < 4.2) {
            if (roll < 0.05) push(out.palms, x, z, 0.85 + random() * 0.5, random() * 6.28);
            else if (roll < 0.09) push(out.rocks, x, z, 0.4 + random() * 0.5, random() * 6.28);
            continue;
        }
        if (slope > 0.5) {
            if (roll < 0.3) push(out.rocks, x, z, 0.6 + random() * 1.2, random() * 6.28);
            continue;
        }

        const wood = clamp(density * 1.5 + 0.55 - nearTown, 0, 1);
        if (roll < wood * 0.5) {
            const cold = h > 34 || z < -160;
            push(cold ? out.pines : out.trees, x, z, 0.75 + random() * 0.55, random() * 6.28);
        } else if (roll < wood * 0.5 + 0.1) {
            push(out.bushes, x, z, 0.6 + random() * 0.7, random() * 6.28);
        } else if (roll < wood * 0.5 + 0.14) {
            push(out.rocks, x, z, 0.3 + random() * 0.5, random() * 6.28);
        }
    }

    /* Grass tufts, dense and close in — these are billboarded and cheap. */
    for (let i = 0; i < 24000; i += 1) {
        const x = (random() * 2 - 1) * WORLD_HALF * 0.9;
        const z = (random() * 2 - 1) * WORLD_HALF * 0.9;
        const h = heightAt(x, z);
        if (h < 3.2 || h > 60) continue;
        if (slopeAt(x, z) > 0.7) continue;
        if (roadInfluenceAt(x, z) > 0.4) continue;
        push(out.grass, x, z, 0.7 + random() * 0.8, random() * 6.28);
    }

    return out;
}

export const WORLD_META = { MOUNTAIN, TOWN, BAY, GRID_CELL, GRID_SIZE };

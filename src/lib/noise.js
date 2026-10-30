/*
 * Value noise, for laying out things that should look grown rather than
 * sprinkled.
 *
 * Scattering trees with a flat per-cell probability gives an even carpet: no
 * clumps, no clearings, no edges, the same density everywhere. Sampling a
 * smooth noise field instead produces masses and gaps — woods that thin into
 * meadows, which is what makes a landscape read as a place.
 *
 * Used by the overworld generator (src/world/build.js, parallax.js), the 3D
 * site scene (src/site3d/SiteScene.js) and the Pup Patrol game
 * (src/pupPatrol/*). Browser-only: neither Convex nor the native app imports
 * it, so it has no determinism contract with a server, only with itself (the
 * same coordinates must give the same value so scenery does not shimmer).
 *
 * The Commons has its own copy of this maths inside src/lib/terrain.js,
 * deliberately left alone: that function defines a live world people have
 * built in, and changing it would move the ground under everything already
 * standing there. The two are NOT interchangeable: the hash here uses
 * Math.imul and adds the salt as is, terrain.js's uses ordinary
 * multiplication and a huge salt multiplier, so the same coordinates and
 * salt give different values.
 */

/* Integer lattice hash in [0, 1). `| 0` and Math.imul keep it in exact 32-bit
   arithmetic, so it is portable across engines without any rounding. */
function hash2(x, y, salt) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + salt;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/*
 * One octave of value noise in [0, 1): `scale` is lattice cells per unit
 * (smaller is broader), `salt` selects an independent field. Interpolates
 * between hashed lattice corners. */
export function noise2(x, y, scale, salt = 0) {
    const nx = x * scale;
    const ny = y * scale;
    const x0 = Math.floor(nx);
    const y0 = Math.floor(ny);
    const fx = smooth(nx - x0);
    const fy = smooth(ny - y0);

    const a = hash2(x0, y0, salt);
    const b = hash2(x0 + 1, y0, salt);
    const c = hash2(x0, y0 + 1, salt);
    const d = hash2(x0 + 1, y0 + 1, salt);

    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
}

/* Broad shapes with finer detail laid over them: three octaves at scale,
   2.7x and 6.1x, weighted 62/26/12 (sums to 1, so the result stays in [0, 1)).
   The odd frequency ratios keep the octaves' lattices from lining up. */
export function fbm(x, y, scale, salt = 0) {
    return (
        noise2(x, y, scale, salt) * 0.62 +
        noise2(x, y, scale * 2.7, salt + 101) * 0.26 +
        noise2(x, y, scale * 6.1, salt + 211) * 0.12
    );
}

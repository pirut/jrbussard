/*
 * Solid things.
 *
 * Everything is approximated as an upright cylinder. A house is not a
 * cylinder, but at the speed you meet one the difference between "bounced off
 * the corner of a box" and "bounced off a circle inscribed in it" is not
 * something you can feel, and the circle costs one subtraction and one square
 * root instead of a separating-axis test.
 *
 * Lookups go through a uniform grid. Without one, every vehicle would test
 * itself against three thousand trees every physics substep, 120 times a
 * second.
 */

import * as THREE from "three";

const CELL = 24;

const _push = new THREE.Vector3();

export class ObstacleField {
    constructor() {
        this.items = [];
        this.grid = new Map();
    }

    key(cx, cz) {
        return cx * 8192 + cz;
    }

    add(x, z, radius, options = {}) {
        const item = {
            x,
            z,
            radius,
            /* How much of your speed survives the impact, and how much the
               obstacle itself gives way. A sapling is not a town hall. */
            restitution: options.restitution ?? 0.28,
            absorb: options.absorb ?? 0.55,
            solid: options.solid ?? true,
            kind: options.kind || "prop",
            top: options.top ?? 40,
        };
        this.items.push(item);

        const cx = Math.floor(x / CELL);
        const cz = Math.floor(z / CELL);
        const reach = Math.ceil(radius / CELL);
        for (let i = -reach; i <= reach; i += 1) {
            for (let j = -reach; j <= reach; j += 1) {
                const k = this.key(cx + i, cz + j);
                let bucket = this.grid.get(k);
                if (!bucket) {
                    bucket = [];
                    this.grid.set(k, bucket);
                }
                bucket.push(item);
            }
        }
        return item;
    }

    /* Register everything in a built group by walking it for meshes tagged
       with a collider hint. */
    addFromScatter(list, radius, options) {
        list.forEach((item) => this.add(item.x, item.z, radius * item.scale, options));
    }

    near(x, z, out) {
        out.length = 0;
        const cx = Math.floor(x / CELL);
        const cz = Math.floor(z / CELL);
        for (let i = -1; i <= 1; i += 1) {
            for (let j = -1; j <= 1; j += 1) {
                const bucket = this.grid.get(this.key(cx + i, cz + j));
                if (!bucket) continue;
                for (let k = 0; k < bucket.length; k += 1) {
                    if (out.indexOf(bucket[k]) === -1) out.push(bucket[k]);
                }
            }
        }
        return out;
    }

    /* Push a body out of anything it has ended up inside, and take the
       appropriate amount of speed off it. Returns the worst impact so the
       caller can play a sound and throw some sparks. */
    resolve(body, bodyRadius, scratch) {
        const list = this.near(body.position.x, body.position.z, scratch);
        let worst = 0;

        for (let i = 0; i < list.length; i += 1) {
            const item = list[i];
            if (!item.solid) continue;
            if (body.position.y > item.top) continue;

            const dx = body.position.x - item.x;
            const dz = body.position.z - item.z;
            const minimum = item.radius + bodyRadius;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq >= minimum * minimum) continue;

            const distance = Math.sqrt(distanceSq) || 0.0001;
            const nx = dx / distance;
            const nz = dz / distance;
            const overlap = minimum - distance;

            body.position.x += nx * overlap;
            body.position.z += nz * overlap;

            const closing = body.velocity.x * nx + body.velocity.z * nz;
            if (closing < 0) {
                if (-closing > worst) worst = -closing;

                /* Split the velocity into the part going into the obstacle and
                   the part sliding along it, and only punish the first. Scaling
                   the whole vector — which is what this did originally — meant
                   clipping a tree at speed stopped you dead instead of
                   deflecting you, and with a wooded island that made the whole
                   thing feel like driving through treacle. */
                const tangentX = body.velocity.x - nx * closing;
                const tangentZ = body.velocity.z - nz * closing;
                const bounce = -closing * item.restitution;
                const slide = 1 - item.absorb * 0.25;

                body.velocity.x = tangentX * slide + nx * bounce;
                body.velocity.z = tangentZ * slide + nz * bounce;

                /* A glancing blow should also spin you a little. */
                if (body.angularVelocity) {
                    const along = tangentX * -nz + tangentZ * nx;
                    body.angularVelocity.y += along * 0.02;
                    _push.set(nx, 0, nz);
                }
            }
        }

        return worst;
    }
}

export const obstacles = new ObstacleField();

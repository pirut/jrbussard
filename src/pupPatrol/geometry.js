/*
 * Shape helpers.
 *
 * The single biggest thing separating "a cartoon rescue truck" from "seven
 * coloured boxes" is that nothing in a cartoon has a sharp edge. Every panel
 * is rounded, every corner catches a highlight, and the silhouette reads as
 * moulded plastic rather than as geometry. These build that.
 */

import * as THREE from "three";

const _p = new THREE.Vector3();
const _inner = new THREE.Vector3();
const _dir = new THREE.Vector3();

/*
 * A box with rounded edges and corners.
 *
 * Built by subdividing a plain box and then projecting every vertex onto the
 * surface of a rounded box: clamp the vertex into the inner core, then step
 * back out by the corner radius along the direction it was pushed. Vertices in
 * the middle of a face do not move, edges bow out into quarter-cylinders and
 * corners into eighth-spheres — which is exactly the shape wanted, at the cost
 * of one clamp and one normalise per vertex.
 */
export function roundedBox(width, height, depth, radius = 0.18, segments = 4) {
    const r = Math.min(radius, width / 2 - 0.001, height / 2 - 0.001, depth / 2 - 0.001);
    const geometry = new THREE.BoxGeometry(width, height, depth, segments, segments, segments);
    const position = geometry.attributes.position;

    const half = new THREE.Vector3(width / 2 - r, height / 2 - r, depth / 2 - r);

    for (let i = 0; i < position.count; i += 1) {
        _p.fromBufferAttribute(position, i);
        _inner.set(
            Math.max(-half.x, Math.min(half.x, _p.x)),
            Math.max(-half.y, Math.min(half.y, _p.y)),
            Math.max(-half.z, Math.min(half.z, _p.z))
        );
        _dir.subVectors(_p, _inner);
        const length = _dir.length();
        if (length > 1e-6) {
            _dir.multiplyScalar(r / length);
            position.setXYZ(i, _inner.x + _dir.x, _inner.y + _dir.y, _inner.z + _dir.z);
        }
    }

    geometry.computeVertexNormals();
    return geometry;
}

/*
 * A chunky cartoon tyre: a lathed profile with a rounded shoulder, so the tread
 * catches light all the way round instead of showing a hard rim like a
 * cylinder does. Axis runs along X once rotated.
 */
export function tyreGeometry(radius, width, shoulder = 0.32) {
    const halfWidth = width / 2;
    const bevel = radius * shoulder;
    const points = [];

    points.push(new THREE.Vector2(radius * 0.42, -halfWidth));
    points.push(new THREE.Vector2(radius - bevel, -halfWidth));
    /* Rounded shoulder into the tread. */
    for (let i = 0; i <= 4; i += 1) {
        const t = (i / 4) * (Math.PI / 2);
        points.push(new THREE.Vector2(radius - bevel + Math.sin(t) * bevel, -halfWidth + (1 - Math.cos(t)) * bevel));
    }
    points.push(new THREE.Vector2(radius, halfWidth - bevel));
    for (let i = 0; i <= 4; i += 1) {
        const t = (i / 4) * (Math.PI / 2);
        points.push(
            new THREE.Vector2(radius - bevel + Math.cos(t) * bevel, halfWidth - bevel + Math.sin(t) * bevel)
        );
    }
    points.push(new THREE.Vector2(radius * 0.42, halfWidth));

    const geometry = new THREE.LatheGeometry(points, 22);
    geometry.rotateZ(Math.PI / 2);
    geometry.computeVertexNormals();
    return geometry;
}

/*
 * A wraparound windscreen: the top half of a sphere, squashed, and sliced so it
 * only covers the front and sides. Every vehicle in the show has one and it is
 * most of what makes them read as friendly rather than military.
 */
export function canopyGeometry(width, height, depth, sweep = Math.PI * 1.35) {
    const geometry = new THREE.SphereGeometry(0.5, 24, 14, -sweep / 2 + Math.PI / 2, sweep, 0, Math.PI * 0.55);
    geometry.scale(width, height, depth);
    return geometry;
}

/* A rounded slab, useful for bumpers, spoilers and running boards. */
export function barGeometry(length, thickness, depth) {
    return roundedBox(length, thickness, depth, Math.min(thickness, depth) * 0.45, 3);
}

/*
 * The paw badge. Every pup wears one, it is on the side of every vehicle and on
 * the front of the Lookout — getting it right does more for recognition than
 * any amount of polygon budget elsewhere.
 */
export function pawGeometry(scale = 1, thickness = 0.12) {
    const shapes = [];

    const pad = new THREE.Shape();
    pad.absellipse(0, -0.12 * scale, 0.34 * scale, 0.3 * scale, 0, Math.PI * 2, false, 0);
    shapes.push(pad);

    const toes = [
        { x: -0.34, y: 0.3, rx: 0.15, ry: 0.19 },
        { x: -0.02, y: 0.42, rx: 0.16, ry: 0.2 },
        { x: 0.3, y: 0.3, rx: 0.15, ry: 0.19 },
    ];
    toes.forEach((toe) => {
        const shape = new THREE.Shape();
        shape.absellipse(toe.x * scale, toe.y * scale, toe.rx * scale, toe.ry * scale, 0, Math.PI * 2, false, 0);
        shapes.push(shape);
    });

    const geometry = new THREE.ExtrudeGeometry(shapes, {
        depth: thickness,
        bevelEnabled: true,
        bevelThickness: thickness * 0.3,
        bevelSize: thickness * 0.25,
        bevelSegments: 2,
        curveSegments: 14,
    });
    geometry.center();
    return geometry;
}

/* A soft-cornered wedge, for roofs and noses. */
export function wedgeGeometry(width, height, depth) {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, -height / 2);
    shape.lineTo(width / 2, -height / 2);
    shape.lineTo(0, height / 2);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness: Math.min(width, height) * 0.08,
        bevelSize: Math.min(width, height) * 0.06,
        bevelSegments: 2,
    });
    geometry.translate(0, 0, -depth / 2);
    return geometry;
}

import * as THREE from "three";
import { material } from "../arcade/ascii3d/materials";

/*
 * Something hangs over the city. Nobody in it talks about it: a dark
 * spindle, point down, inside two rings of light that turn against each
 * other, hanging past the far edge of the city.
 */
export function buildVisitor() {
    const group = new THREE.Group();
    const parts = [];
    const add = (geometry, mat, y = 0) => {
        const mesh = new THREE.Mesh(geometry, mat);
        mesh.position.y = y;
        group.add(mesh);
        parts.push(mesh);
        return mesh;
    };
    const body = add(new THREE.OctahedronGeometry(1, 0).scale(3.2, 11, 3.2), material("#2a2733", "solid"), 22);
    const belt = add(new THREE.TorusGeometry(3.4, 0.22, 4, 32).rotateX(Math.PI / 2), material("#a98cff", "fire", { unlit: true }), 22);
    const outer = add(new THREE.TorusGeometry(15, 0.4, 6, 96), material("#7fe0d6", "fire", { unlit: true }), 22);
    const inner = add(new THREE.TorusGeometry(10, 0.3, 6, 72), material("#a98cff", "fire", { unlit: true }), 22);
    const tip = add(new THREE.OctahedronGeometry(0.8, 0), material("#ff7ad9", "fire", { unlit: true }), 8.5);
    outer.rotation.x = Math.PI / 2 - 0.35;
    inner.rotation.x = Math.PI / 2 + 0.5;
    return {
        group,
        update(t) {
            body.rotation.y = t * 0.05;
            belt.rotation.z = t * 0.2;
            outer.rotation.z = t * 0.06;
            inner.rotation.z = -t * 0.09;
            inner.rotation.y = Math.sin(t * 0.05) * 0.3;
            group.position.y = Math.sin(t * 0.2) * 0.8;
            tip.position.y = 8.5 + Math.sin(t * 0.9) * 0.4;
        },
        dispose() {
            parts.forEach((m) => m.geometry.dispose());
        },
    };
}

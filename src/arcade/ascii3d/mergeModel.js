import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { releaseFigure } from "./figureGeometry";

/*
 * Fewer draw calls for a posed figure.
 *
 * A person is a tree of pivots (hips, knees, shoulders, neck) with the
 * visible parts hung off them: a head, a nose, two eyes, a hat brim. Posing
 * turns the pivots; the parts never move against the pivot they hang from.
 * So every leaf part under one pivot that shares a material can be one mesh,
 * which turns a figure of thirty-odd draws into a dozen or so, in the main
 * pass and again in the shadow pass.
 *
 * Anything posing or the scene reaches for by reference (the rig's pivots, a
 * cape, a flame) is left alone, as is anything with children of its own.
 * The merged geometry belongs to the model; disposeMerged() frees it.
 */

function referenced(model) {
    const keep = new Set();
    const visit = (value, depth) => {
        if (!value || depth > 3) return;
        if (value.isObject3D) {
            keep.add(value);
            return;
        }
        if (typeof value === "object") Object.values(value).forEach((v) => visit(v, depth + 1));
    };
    visit(model.userData, 0);
    return keep;
}

function signature(mesh) {
    const g = mesh.geometry;
    const attributes = Object.keys(g.attributes).sort().join(",");
    return `${mesh.material.uuid}|${attributes}|${g.index ? 1 : 0}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
}

export function mergeModel(model) {
    const keep = referenced(model);
    const parents = [];
    model.traverse((node) => {
        if (node.children.length) parents.push(node);
    });
    parents.forEach((parent) => {
        const groups = new Map();
        parent.children.forEach((child) => {
            if (!child.isMesh || child.isInstancedMesh || !child.visible || child.children.length || keep.has(child)) return;
            if (Array.isArray(child.material) || child.userData.flame || child.material.userData?.own) return;
            /* Figure parts are already merged, and share their geometry. */
            if (child.userData.figureKey) return;
            const key = signature(child);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(child);
        });
        groups.forEach((meshes) => {
            if (meshes.length < 2) return;
            const parts = meshes.map((mesh) => {
                mesh.updateMatrix();
                return mesh.geometry.clone().applyMatrix4(mesh.matrix);
            });
            const geometry = mergeGeometries(parts, false);
            parts.forEach((g) => g.dispose());
            if (!geometry) return;
            const merged = new THREE.Mesh(geometry, meshes[0].material);
            merged.castShadow = meshes[0].castShadow;
            merged.receiveShadow = meshes[0].receiveShadow;
            merged.userData.merged = true;
            meshes.forEach((mesh) => parent.remove(mesh));
            parent.add(merged);
        });
    });
    return model;
}

/* Free what mergeModel() made, and give back the figure geometry the model
   shares with others (figureGeometry.js), which is freed with its last user.
   Shared prototype geometry is left alone. */
export function disposeMerged(model) {
    model.traverse((node) => {
        if (node.userData.merged) node.geometry.dispose();
    });
    releaseFigure(model);
}

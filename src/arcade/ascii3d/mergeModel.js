import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { isFigureGeometry, releaseFigure } from "./figureGeometry";

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
 *
 * Called by AsciiWorld on every person, creature and structure it builds
 * (always after trimShadows(), so the shadow flags it merges on are already
 * final), and paired with disposeMerged() when the model leaves. Run it once
 * per model, after the model is fully built: the meshes it replaces are not
 * disposed (their geometry is shared prototype or figure geometry), so only
 * the final merged meshes are freed later. It does not merge across
 * materials or parents, nor the figure geometry that figureGeometry.js has
 * already merged per body part.
 */

/* Every Object3D reachable from model.userData (a few levels deep): the
   things posing and effects hold by reference, which must stay separate
   nodes. The depth cap is a guard against cycles, not a measured need. */
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

/* Two meshes can share a draw only if everything the renderer would vary on
   matches: material, which vertex attributes exist, indexed or not, and
   both shadow flags. */
function signature(mesh) {
    const g = mesh.geometry;
    const attributes = Object.keys(g.attributes).sort().join(",");
    return `${mesh.material.uuid}|${attributes}|${g.index ? 1 : 0}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}`;
}

/* Merge in place and return `model`. Works one parent at a time: sibling
   meshes with the same signature become one mesh whose vertices are baked
   into the parent's space (each child's local matrix applied), so the
   result renders identically with fewer draw calls. Groups of one are left
   alone. The new mesh is marked userData.merged so disposeMerged() can find
   it; it shares the first mesh's material, which it does not own. */
export function mergeModel(model) {
    const keep = referenced(model);
    /* Collected first: merging edits the children lists. */
    const parents = [];
    model.traverse((node) => {
        if (node.children.length) parents.push(node);
    });
    parents.forEach((parent) => {
        const groups = new Map();
        parent.children.forEach((child) => {
            if (!child.isMesh || child.isInstancedMesh || !child.visible || child.children.length || keep.has(child)) return;
            /* A material flagged userData.own is private to its mesh because
               something animates it (a flame, site3d/props.js), so the
               mesh cannot be folded into a shared draw. */
            if (Array.isArray(child.material) || child.userData.flame || child.material.userData?.own) return;
            /* Figure parts are already merged, and share their geometry. */
            if (isFigureGeometry(child.geometry)) return;
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
            /* `false`: no per-part groups, one draw. Returns null if the
               attribute sets disagree, in which case nothing is changed. */
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

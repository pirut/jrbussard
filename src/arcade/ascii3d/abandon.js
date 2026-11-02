import { releaseFigure } from "./figureGeometry";

/*
 * Cleanup for a scene whose constructor threw. Called from the catch around
 * the constructor in AsciiWorld, site3d/Diorama.js and site3d/SiteScene.js,
 * with the half-built `this` as `scene`, so any property read here may be
 * undefined: each step checks what it touches, and each runs on its own.
 *
 * dispose() goes first because it knows the scene's real teardown, but on a
 * scene that stopped early it will usually throw part-way (AsciiWorld's
 * reads this.observer, this.ghosts and so on without checks); the steps after
 * it are the safety net for what it did not reach. Releasing the material
 * hold twice is harmless (a hold counts once, see materials.js
 * retainMaterials).
 *
 * For a scene whose constructor threw: the caller never got the instance,
 * so nothing else will ever dispose of it. Undo whatever it got as far as
 * taking (its material hold, the figures in its scene, the observer, the
 * renderer and its canvas), each step on its own so one that fails on a
 * half-built scene does not stop the rest.
 */
export function abandon(scene) {
    [
        () => scene.dispose(),
        () => scene.materials && scene.materials.release(),
        () => scene.scene && releaseFigure(scene.scene),
        () => cancelAnimationFrame(scene.raf),
        () => scene.observer && scene.observer.disconnect(),
        () => scene.renderer && scene.renderer.dispose(),
        () => scene.renderer && scene.renderer.domElement.remove(),
    ].forEach((step) => {
        try {
            step();
        } catch {
            /* Half-built: carry on with the rest. */
        }
    });
}

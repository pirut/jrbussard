import { releaseFigure } from "./figureGeometry";

/*
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

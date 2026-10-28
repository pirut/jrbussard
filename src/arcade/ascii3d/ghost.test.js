import * as THREE from "three";
import { Ghosts } from "./ghost";

/* A ghost stands on the ground as it is now, even when someone else digs
   or piles that tile while the ghost is up. */
describe("the build ghost", () => {
    it("follows the ground when the tile's height changes under it", () => {
        const ghosts = new Ghosts(new THREE.Scene());
        const list = [{ x: 3, y: 4, kind: "wall", facing: 0, ok: true }];
        ghosts.set(list, () => ({ height: 1.2, overWater: false, deck: 0 }));
        expect(ghosts.group.children[0].position.y).toBeCloseTo(1.2);
        ghosts.set(list, () => ({ height: 0.6, overWater: false, deck: 0 }));
        expect(ghosts.group.children[0].position.y).toBeCloseTo(0.6);
    });
});

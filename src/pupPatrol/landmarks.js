/*
 * The built environment: the Lookout, the town, the harbour, the farm, the
 * lighthouse, the lodge.
 *
 * Landmarks do more than decorate. An open world with nothing on the skyline
 * is a world you get lost in — you need to be able to glance up, see the
 * Lookout on its bluff, and know which way home is. That is why the tower is
 * tall out of all proportion to its footprint, and why the lighthouse sits on
 * the one headland you can see from most of the island.
 */

import * as THREE from "three";
import { heightAt, placeById, roads, roadInfluenceAt, PLACES } from "./world";
import { makeWoodTexture } from "./textures";
import { makeRandom } from "./noise";
import { obstacles } from "./obstacles";
import { roundedBox, pawGeometry } from "./geometry";

const materials = new Map();

/* Standard rather than Lambert: the buildings want a specular highlight to
   read as painted render and glazed glass instead of flat matte cardboard,
   and there are only a few dozen of them. */
let materialSeq = 0;
function mat(color, opts = {}) {
    const key = opts.map
        ? `map${(opts.map.uuid || (opts.map.uuid = `t${materialSeq++}`))}`
        : `${color}|${opts.roughness ?? ""}|${opts.metalness ?? ""}|${opts.emissive ?? ""}|${opts.opacity ?? ""}`;
    if (!materials.has(key)) {
        materials.set(
            key,
            new THREE.MeshStandardMaterial({
                color,
                roughness: opts.roughness ?? 0.62,
                metalness: opts.metalness ?? 0.04,
                emissive: opts.emissive || 0x000000,
                emissiveIntensity: opts.emissiveIntensity || 1,
                transparent: opts.opacity !== undefined,
                opacity: opts.opacity !== undefined ? opts.opacity : 1,
                map: opts.map || null,
                side: opts.side || THREE.FrontSide,
            })
        );
    }
    return materials.get(key);
}

/* Nothing in Adventure Bay has a sharp corner, so the default building block
   here is a rounded one. */
function box(w, h, d, color, x = 0, y = 0, z = 0, opts) {
    const radius = Math.min(w, h, d) * (opts && opts.sharp ? 0.02 : 0.14);
    const m = new THREE.Mesh(roundedBox(w, h, d, radius, 3), mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

/* Place an arbitrary geometry with a colour. */
function mesh(geometry, color, opts, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geometry, mat(color, opts));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

function cylinder(rTop, rBottom, h, color, segments, opts) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat(color, opts));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

function cone(r, h, color, segments, opts) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, segments), mat(color, opts));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
}

/* Drops a group onto the terrain wherever it is put. */
function ground(group, x, z, rotation = 0) {
    group.position.set(x, heightAt(x, z), z);
    group.rotation.y = rotation;
    return group;
}

/* ---------------------------------------------------------------- *
 * The Lookout
 * ---------------------------------------------------------------- */

/*
 * The Lookout.
 *
 * If one thing has to be right it is this. Everybody who has watched the show
 * can draw it from memory: a slim white tower on a green headland, a glass
 * observation deck ringed with windows, a red cone roof, and an enormous paw
 * badge facing the bay. It also has to be legible from a kilometre away, so
 * the badge and the roof are both larger than strict proportion would allow —
 * they are the landmark you navigate the whole island by.
 */
function buildLookout() {
    const group = new THREE.Group();
    group.name = "lookout";

    const white = { roughness: 0.42, metalness: 0.06 };
    const glassy = { roughness: 0.08, metalness: 0.4, opacity: 0.52 };

    /* Terrace and steps. */
    const terrace = cylinder(15, 16, 1.2, 0xdfe6ec, 28, white);
    terrace.position.y = 0.2;
    group.add(terrace);
    const plinth = cylinder(10.5, 12, 3.0, 0xf2f6fa, 26, white);
    plinth.position.y = 2.2;
    group.add(plinth);

    /* Shaft: gently tapered, with a soft top so it does not read as a pipe. */
    const shaft = cylinder(5.0, 6.6, 24, 28, white);
    shaft.material = mat(0xf6f9fc, white);
    shaft.position.y = 15.4;
    group.add(shaft);

    /* Blue trim band, the one strong colour on the tower itself. */
    const band = cylinder(5.9, 6.1, 1.6, 0x2f6fe0, 28, { roughness: 0.3 });
    band.position.y = 8.6;
    group.add(band);

    /* Observation deck: a wide skirt, a ring of glass, a domed cap. */
    const skirt = new THREE.Mesh(
        new THREE.CylinderGeometry(10.4, 6.2, 2.6, 30),
        mat(0x2f6fe0, { roughness: 0.28 })
    );
    skirt.position.y = 28.6;
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    group.add(skirt);

    const deckFloor = cylinder(10.2, 10.2, 0.6, 0xf2f6fa, 30, white);
    deckFloor.position.y = 30.1;
    group.add(deckFloor);

    const glass = cylinder(9.5, 9.8, 7.0, 0xb9e6ff, 30, glassy);
    glass.position.y = 33.8;
    group.add(glass);

    /* Window mullions. */
    for (let i = 0; i < 10; i += 1) {
        const angle = (i / 10) * Math.PI * 2;
        const post = mesh(
            roundedBox(0.42, 7.0, 0.42, 0.14, 2),
            0xffffff,
            white,
            Math.cos(angle) * 9.7,
            33.8,
            Math.sin(angle) * 9.7
        );
        post.rotation.y = -angle;
        group.add(post);
    }

    const rim = new THREE.Mesh(new THREE.TorusGeometry(9.8, 0.42, 10, 30), mat(0xf2f6fa, white));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 37.4;
    rim.castShadow = true;
    group.add(rim);

    /* Red cone roof with a rolled edge. */
    const roof = cone(11.4, 5.6, 0xdc3b2c, 30, { roughness: 0.35 });
    roof.position.y = 40.3;
    group.add(roof);
    const eave = new THREE.Mesh(new THREE.TorusGeometry(11.2, 0.5, 10, 30), mat(0xb8291d, { roughness: 0.4 }));
    eave.rotation.x = Math.PI / 2;
    eave.position.y = 37.7;
    eave.castShadow = true;
    group.add(eave);

    const finial = cylinder(0.18, 0.3, 4.6, 0xd8dde3, 10, { roughness: 0.2, metalness: 0.8 });
    finial.position.y = 45.2;
    group.add(finial);
    const beaconLamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.65, 14, 10),
        mat(0xffd23f, { emissive: 0xffb400, emissiveIntensity: 1.2, roughness: 0.2 })
    );
    beaconLamp.position.y = 47.6;
    group.add(beaconLamp);
    group.userData.beaconLamp = beaconLamp;

    /* The badge. Yellow disc, blue ring, dark blue paw — big enough to read
       from the far side of the bay. */
    const badgePlate = cylinder(5.4, 5.4, 0.7, 0x2f6fe0, 34, { roughness: 0.3 });
    badgePlate.rotation.x = Math.PI / 2;
    badgePlate.position.set(0, 20.5, 5.6);
    group.add(badgePlate);

    const badgeFace = cylinder(4.6, 4.6, 0.75, 0xffd23f, 34, { roughness: 0.3 });
    badgeFace.rotation.x = Math.PI / 2;
    badgeFace.position.set(0, 20.5, 5.75);
    group.add(badgeFace);

    const paw = new THREE.Mesh(pawGeometry(6.0, 0.5), mat(0x1f4fa8, { roughness: 0.35 }));
    paw.position.set(0, 20.5, 6.2);
    paw.castShadow = true;
    group.add(paw);

    /* Garage bays fanned around the foot, each with its pup's door colour. */
    const doorColours = [0x2f6fe0, 0xe0392b, 0xff77c0, 0xf6c31f, 0x49a84c, 0xff8b3d];
    for (let i = 0; i < 6; i += 1) {
        const angle = -1.35 + i * 0.54;
        const cx = Math.cos(angle) * 14.5;
        const cz = Math.sin(angle) * 14.5;
        const bay = mesh(roundedBox(6.6, 5.6, 9.0, 0.7, 3), 0xf2f6fa, white, cx, 3.0, cz);
        bay.rotation.y = -angle + Math.PI / 2;
        group.add(bay);

        const roofPad = mesh(roundedBox(6.8, 0.7, 9.2, 0.3, 2), 0x2f6fe0, { roughness: 0.3 }, cx, 5.9, cz);
        roofPad.rotation.y = -angle + Math.PI / 2;
        group.add(roofPad);

        const door = mesh(
            roundedBox(5.4, 4.2, 0.5, 0.24, 2),
            doorColours[i],
            { roughness: 0.28 },
            Math.cos(angle) * 19.0,
            2.5,
            Math.sin(angle) * 19.0
        );
        door.rotation.y = -angle + Math.PI / 2;
        group.add(door);

        const doorPaw = new THREE.Mesh(pawGeometry(1.5, 0.12), mat(0xffffff, { roughness: 0.3 }));
        doorPaw.position.set(Math.cos(angle) * 19.4, 2.6, Math.sin(angle) * 19.4);
        doorPaw.rotation.y = -angle + Math.PI / 2;
        group.add(doorPaw);
    }

    /* Glass lift shaft up the side. */
    const tube = cylinder(1.7, 1.7, 28, 0xcdeaff, 16, { roughness: 0.08, metalness: 0.4, opacity: 0.4 });
    tube.position.set(-6.9, 15.5, -1.4);
    group.add(tube);
    const car = cylinder(1.5, 1.5, 2.4, 0xffd23f, 14, { roughness: 0.3 });
    car.position.set(-6.9, 6, -1.4);
    group.add(car);
    group.userData.lift = car;

    /* Flagpole and a slide down to the forecourt. */
    const slide = new THREE.Mesh(
        new THREE.TorusGeometry(9, 0.55, 10, 24, Math.PI * 0.62),
        mat(0xffd23f, { roughness: 0.3 })
    );
    slide.position.set(7.5, 20.0, -2.2);
    slide.rotation.set(0, -0.5, Math.PI * 0.52);
    slide.castShadow = true;
    group.add(slide);

    group.userData.height = 48;
    return group;
}

/* ---------------------------------------------------------------- *
 * Town
 * ---------------------------------------------------------------- */

/* Sweet-shop colours. Adventure Bay is a seaside town painted by somebody who
   likes ice cream; nothing is beige. */
const HOUSE_COLOURS = [0xfff1d6, 0xffd9a0, 0xd8f0d0, 0xcfe6fb, 0xffd2d2, 0xfff6c9, 0xe6dcf7, 0xffe0ef];
const ROOF_COLOURS = [0xd8382c, 0x2f6fe0, 0x3f9c53, 0xef8b1f, 0x7a4b8f, 0x2a8f9e, 0xe0489a];
const AWNING_COLOURS = [0xe0392b, 0x2f6fe0, 0x3f9c53, 0xef8b1f, 0xffd23f];
const SHOP_SIGNS = ["BAKERY", "MR PORTER", "DINER", "ICE CREAM", "TOYS", "HARDWARE", "FLOWERS", "PIZZA"];

function signTexture(text, background) {
    const el = document.createElement("canvas");
    el.width = 256;
    el.height = 64;
    const ctx = el.getContext("2d");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px 'Baloo 2', 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 36);
    const tex = new THREE.CanvasTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function buildHouse(random, scale = 1) {
    const group = new THREE.Group();
    const isShop = random() < 0.45;
    const w = (6 + random() * 4) * scale;
    const d = (5.5 + random() * 3.5) * scale;
    const storeys = random() < 0.42 ? 2 : 1;
    const h = (3.6 + random() * 0.7) * storeys * scale;
    const wallColour = HOUSE_COLOURS[Math.floor(random() * HOUSE_COLOURS.length)];
    const roofColour = ROOF_COLOURS[Math.floor(random() * ROOF_COLOURS.length)];

    group.add(box(w, h, d, wallColour, 0, h / 2, 0, { roughness: 0.72 }));

    /* Pitched roof from a four-sided pyramid, squashed to the footprint. A
       cone would read as a circus tent. */
    const roofHeight = (1.7 + random() * 1.3) * scale;
    const roof = new THREE.Mesh(
        new THREE.CylinderGeometry(0, Math.max(w, d) * 0.8, roofHeight, 4),
        mat(roofColour, { roughness: 0.55 })
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = h + roofHeight / 2;
    roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    roof.castShadow = true;
    roof.receiveShadow = true;
    group.add(roof);

    /* Roof trim, so the eaves are not a knife edge. */
    group.add(box(w * 1.06, 0.3 * scale, d * 1.06, 0xffffff, 0, h + 0.1, 0, { roughness: 0.6 }));

    const glass = { roughness: 0.1, metalness: 0.45 };
    for (let s = 0; s < storeys; s += 1) {
        const y = 1.9 * scale + s * 3.6 * scale;
        for (const side of [-1, 1]) {
            /* Window, with a painted frame around it. */
            group.add(box(1.5 * scale, 1.7 * scale, 0.14, 0xffffff, side * w * 0.27, y, d / 2 + 0.03));
            group.add(box(1.15 * scale, 1.35 * scale, 0.18, 0x7fc4e8, side * w * 0.27, y, d / 2 + 0.06, glass));
            group.add(box(0.16, 1.4 * scale, 1.15 * scale, 0x7fc4e8, (side * w) / 2 + 0.04, y, d * 0.2, glass));
        }
    }

    if (isShop) {
        /* Shopfront: big window, striped awning, name board over the top. */
        const awningColour = AWNING_COLOURS[Math.floor(random() * AWNING_COLOURS.length)];
        group.add(box(w * 0.82, 2.4 * scale, 0.2, 0x9fdcf5, 0, 1.5 * scale, d / 2 + 0.05, glass));

        const awning = new THREE.Mesh(
            new THREE.CylinderGeometry(1.5 * scale, 1.5 * scale, w * 0.92, 14, 1, false, 0, Math.PI * 0.62),
            mat(awningColour, { roughness: 0.7, side: THREE.DoubleSide })
        );
        awning.rotation.z = Math.PI / 2;
        awning.rotation.y = -Math.PI * 0.31;
        awning.position.set(0, 3.3 * scale, d / 2 + 0.5);
        awning.castShadow = true;
        group.add(awning);

        const board = new THREE.Mesh(
            new THREE.BoxGeometry(w * 0.8, 1.1 * scale, 0.16),
            new THREE.MeshStandardMaterial({
                map: signTexture(SHOP_SIGNS[Math.floor(random() * SHOP_SIGNS.length)], "#2b3a4a"),
                roughness: 0.6,
            })
        );
        board.position.set(0, h + 0.55 * scale, d / 2 + 0.1);
        board.castShadow = true;
        group.add(board);
    } else {
        group.add(box(1.5 * scale, 2.7 * scale, 0.2, 0xffffff, 0, 1.35 * scale, d / 2 + 0.04));
        group.add(box(1.15 * scale, 2.4 * scale, 0.24, 0xa9633a, 0, 1.2 * scale, d / 2 + 0.07, { roughness: 0.65 }));
        /* Doorstep and a lamp beside it. */
        group.add(box(2.2 * scale, 0.24, 1.0 * scale, 0xe8e2d6, 0, 0.12, d / 2 + 0.5));
    }

    if (random() < 0.45) {
        group.add(box(1.0 * scale, 2.4 * scale, 1.0 * scale, 0xc06a52, w * 0.28, h + 1.3 * scale, -d * 0.2));
    }

    /* Window boxes of flowers on about half of them. */
    if (random() < 0.5) {
        for (const side of [-1, 1]) {
            group.add(box(1.5 * scale, 0.3 * scale, 0.5 * scale, 0x8a5a34, side * w * 0.27, 1.15 * scale, d / 2 + 0.3));
            const bloom = ["#ff5c8a", "#ffd23f", "#ff8b3d"][Math.floor(random() * 3)];
            group.add(
                box(1.3 * scale, 0.34 * scale, 0.4 * scale, parseInt(bloom.slice(1), 16), side * w * 0.27, 1.42 * scale, d / 2 + 0.3, {
                    roughness: 0.8,
                })
            );
        }
    }

    return group;
}

function buildCityHall() {
    const group = new THREE.Group();
    group.add(box(20, 9, 13, 0xf3e8d2, 0, 4.5, 0));
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 15, 4.4, 4), mat(0x2a6f7a));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 11.2;
    roof.scale.set(20 / 26, 1, 13 / 26);
    roof.castShadow = true;
    group.add(roof);

    /* Portico. */
    for (let i = -2; i <= 2; i += 1) {
        group.add(cylinder(0.55, 0.62, 7.4, 0xfdf8ee, 12).translateX(i * 3.4).translateY(3.7).translateZ(7.4));
    }
    group.add(box(18, 1.1, 3.4, 0xfdf8ee, 0, 8, 7.4));

    const clock = cylinder(2.6, 2.6, 0.5, 0xfff6df, 20);
    clock.rotation.x = Math.PI / 2;
    clock.position.set(0, 8.6, 6.7);
    group.add(clock);
    group.add(box(0.2, 1.8, 0.16, 0x2b3440, 0, 9.2, 6.4));
    group.add(box(1.3, 0.18, 0.16, 0x2b3440, 0.5, 8.6, 6.4));

    const cupola = cylinder(2.0, 2.2, 3.4, 0xfdf8ee, 12);
    cupola.position.y = 13.6;
    group.add(cupola);
    const spire = cone(2.6, 3.6, 0xc0392b, 12);
    spire.position.y = 17;
    group.add(spire);
    return group;
}

/* True if a footprint of this radius would sit on, or hang over, the tarmac.
 *
 * The threshold matters: road influence is the *terrain flattening* field,
 * which reaches about 26 m from the centreline of Main Street, while the
 * carriageway itself is 11 m wide. Testing against a low influence therefore
 * rejects everything within half a block of a road, which emptied the entire
 * town on the first attempt. 0.9 corresponds to roughly the kerb. */
const ON_TARMAC = 0.9;

function overlapsRoad(x, z, radius) {
    if (roadInfluenceAt(x, z) > ON_TARMAC) return true;
    for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2;
        if (roadInfluenceAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius) > ON_TARMAC) return true;
    }
    return false;
}

/*
 * What turns a house into a home someone lives in.
 *
 * A cottage dropped onto open grass reads as an asset, not as a building —
 * there is nothing between its front door and the road, so nothing says a
 * person walks between the two. A path, a fence and a couple of shrubs cost
 * nine boxes and fix it completely.
 *
 * Every piece samples the terrain at its own position rather than inheriting
 * one height from the house, because even the levelled town bowl has a metre
 * of fall across a garden, and a fence built flat on it hangs in the air at
 * one end and is buried at the other.
 */
function buildFrontGarden(x, z, facing, random) {
    const garden = new THREE.Group();
    const cos = Math.cos(facing);
    const sin = Math.sin(facing);

    /* Local frame: +out toward the road, +side across the frontage. */
    const at = (out, side) => ({ x: x + sin * out + cos * side, z: z + cos * out - sin * side });

    const paving = 0xd7cfbe;
    for (let i = 0; i < 5; i += 1) {
        const p = at(4.6 + i * 1.9, 0);
        const slab = box(1.7, 0.14, 1.55, paving, p.x, heightAt(p.x, p.z) + 0.07, p.z, { roughness: 0.85 });
        slab.rotation.y = facing;
        slab.receiveShadow = true;
        garden.add(slab);
    }

    /* Picket fence along the frontage, with a gap where the path crosses it. */
    const fenceOut = 13.2;
    const paint = random() < 0.5 ? 0xf6f2e8 : 0xe8dcc6;
    for (let s = -4; s <= 4; s += 1) {
        if (Math.abs(s) < 1) continue;
        const p = at(fenceOut, s * 1.5);
        const y = heightAt(p.x, p.z);
        garden.add(box(0.16, 1.1, 0.16, paint, p.x, y + 0.55, p.z, { roughness: 0.8 }));
        if (s < 4 && Math.abs(s + 1) >= 1) {
            const next = at(fenceOut, (s + 1) * 1.5);
            const rail = box(1.5, 0.12, 0.09, paint, (p.x + next.x) / 2, y + 0.78, (p.z + next.z) / 2, {
                roughness: 0.8,
            });
            rail.rotation.y = facing;
            garden.add(rail);
        }
    }

    /* Two shrubs and, on about half of them, a letterbox at the gate. */
    for (const side of [-1, 1]) {
        if (random() < 0.3) continue;
        const p = at(6.5 + random() * 3, side * (2.6 + random() * 1.6));
        const y = heightAt(p.x, p.z);
        const r = 0.7 + random() * 0.5;
        const bush = mesh(new THREE.IcosahedronGeometry(r, 1), 0x4f9c3a, { roughness: 0.9 }, p.x, y + r * 0.7, p.z);
        bush.scale.set(1.2, 0.85, 1.2);
        garden.add(bush);
    }
    if (random() < 0.55) {
        const p = at(fenceOut - 0.4, 1.5);
        const y = heightAt(p.x, p.z);
        garden.add(box(0.14, 1.2, 0.14, 0x8a6134, p.x, y + 0.6, p.z, { roughness: 0.8 }));
        const flag = box(0.42, 0.34, 0.5, 0xd8382c, p.x, y + 1.32, p.z, { roughness: 0.6 });
        flag.rotation.y = facing;
        garden.add(flag);
    }

    return garden;
}

/* A street lamp. Adventure Bay is permanently at midday, so the lamp is not
   for lighting anything — it is a vertical, at a regular interval, which is
   what makes a stretch of road read as a street rather than as a lane. */
function buildStreetLamp(x, z, facing) {
    const lamp = new THREE.Group();
    const y = heightAt(x, z);

    lamp.add(cylinder(0.3, 0.42, 0.5, 0x9aa1a8, 10).translateX(x).translateY(y + 0.25).translateZ(z));
    lamp.add(cylinder(0.13, 0.17, 5.2, 0x3c4650, 10).translateX(x).translateY(y + 2.9).translateZ(z));

    const arm = box(0.14, 0.14, 1.5, 0x3c4650, x + Math.sin(facing) * 0.6, y + 5.4, z + Math.cos(facing) * 0.6);
    arm.rotation.y = facing;
    lamp.add(arm);

    const head = box(0.7, 0.3, 0.95, 0x3c4650, x + Math.sin(facing) * 1.25, y + 5.25, z + Math.cos(facing) * 1.25);
    head.rotation.y = facing;
    lamp.add(head);

    const glass = box(
        0.55,
        0.16,
        0.78,
        0xfff3c4,
        x + Math.sin(facing) * 1.25,
        y + 5.06,
        z + Math.cos(facing) * 1.25,
        { emissive: 0xffe27a, emissiveIntensity: 0.35, roughness: 0.2 }
    );
    glass.rotation.y = facing;
    lamp.add(glass);

    return lamp;
}

/* Where the town meets the road, laid out along the actual centreline rather
   than on a grid — the streets curve, and buildings on a grid would float. */
function buildTown() {
    const group = new THREE.Group();
    group.name = "town";
    const random = makeRandom(90210);

    const main = roads.find((r) => r.id === "main");
    const townCentre = placeById("townsquare");

    const hall = placeById("cityhall");
    /* Reserve the ground the civic buildings stand on before scattering
       houses, or a cottage lands in the middle of City Hall. */
    const placed = [
        { x: hall.x, z: hall.z, radius: 18 },
        { x: townCentre.x - 16, z: townCentre.z + 18, radius: 9 },
    ];
    const tooClose = (x, z, radius) => placed.some((p) => Math.hypot(p.x - x, p.z - z) < radius + p.radius);

    if (main) {
        for (let i = 6; i < main.path.length - 6; i += 3) {
            const [x, z] = main.path[i];
            if (Math.hypot(x - townCentre.x, z - townCentre.z) > 120) continue;

            const [px, pz] = main.path[i - 3];
            const [nx, nz] = main.path[i + 3];
            let tx = nx - px;
            let tz = nz - pz;
            const len = Math.hypot(tx, tz) || 1;
            tx /= len;
            tz /= len;

            for (const side of [-1, 1]) {
                if (random() < 0.24) continue;
                const offset = 18 + random() * 9;
                const hx = x - tz * side * offset;
                const hz = z + tx * side * offset;
                if (tooClose(hx, hz, 7)) continue;
                /* Offsetting perpendicular to the local tangent is not enough
                   on a bend: the road curves back under the house and you end
                   up with a cottage parked across Main Street, which stops the
                   police cruiser dead at ninety. Ask the road grid directly. */
                if (overlapsRoad(hx, hz, 6.5)) continue;
                const house = buildHouse(random, 0.9 + random() * 0.4);
                /* Front door toward the street it stands on. */
                const facing = Math.atan2(x - hx, z - hz);
                ground(house, hx, hz, facing);
                group.add(house);
                group.add(buildFrontGarden(hx, hz, facing, random));
                placed.push({ x: hx, z: hz, radius: 7 });
                /* Halfway between the inscribed and circumscribed circle of a
                   typical footprint. Inscribed lets you drive through the
                   corners of the bakery; circumscribed puts an invisible wall
                   a metre out from every wall. */
                obstacles.add(hx, hz, 5.2, { kind: "building", restitution: 0.34, absorb: 0.42 });
            }
        }
    }

    /* Street lamps down Main Street, alternating sides. */
    if (main) {
        let side = 1;
        for (let i = 4; i < main.path.length - 4; i += 11) {
            const [x, z] = main.path[i];
            if (Math.hypot(x - townCentre.x, z - townCentre.z) > 135) continue;
            const [px, pz] = main.path[i - 3];
            const [nx, nz] = main.path[i + 3];
            let tx = nx - px;
            let tz = nz - pz;
            const len = Math.hypot(tx, tz) || 1;
            tx /= len;
            tz /= len;
            const offset = 6.4;
            const lx = x - tz * side * offset;
            const lz = z + tx * side * offset;
            group.add(buildStreetLamp(lx, lz, Math.atan2(x - lx, z - lz)));
            side = -side;
        }
    }

    const hallGroup = buildCityHall();
    ground(hallGroup, hall.x, hall.z, 1.9);
    group.add(hallGroup);

    /* A little park in the square. */
    const square = new THREE.Group();
    const fountainBase = cylinder(4.2, 4.6, 0.9, 0xd9d3c4, 18);
    fountainBase.position.y = 0.45;
    square.add(fountainBase);
    const water = cylinder(3.6, 3.6, 0.4, 0x4fd6c8, 18, { opacity: 0.85 });
    water.position.y = 0.85;
    square.add(water);
    const spout = cylinder(0.4, 0.7, 2.4, 0xd9d3c4, 10);
    spout.position.y = 1.9;
    square.add(spout);
    ground(square, townCentre.x - 16, townCentre.z + 18);
    group.add(square);

    return group;
}

/* ---------------------------------------------------------------- *
 * Coast
 * ---------------------------------------------------------------- */

function buildLighthouse() {
    const group = new THREE.Group();
    const tower = cylinder(2.6, 4.4, 22, 18, {});
    tower.material = mat(0xf7f7f7);
    tower.position.y = 11;
    group.add(tower);

    /* Red bands. */
    for (let i = 0; i < 3; i += 1) {
        const y = 4 + i * 6.6;
        const r = 4.4 - (y / 22) * 1.8 + 0.06;
        const band = cylinder(r - 0.25, r, 2.4, 0xd8382c, 18);
        band.position.y = y;
        group.add(band);
    }

    const gallery = cylinder(3.6, 3.6, 0.7, 0x3a4550, 18);
    gallery.position.y = 22.4;
    group.add(gallery);

    const lampRoom = cylinder(2.5, 2.5, 3.2, 0xfff3c4, 16, { emissive: 0xffe27a, emissiveIntensity: 0.5 });
    lampRoom.position.y = 24.3;
    group.add(lampRoom);

    const cap = cone(3.2, 2.6, 0x2f4858, 16);
    cap.position.y = 27.2;
    group.add(cap);

    const beacon = new THREE.PointLight(0xffe9a8, 0, 160, 1.6);
    beacon.position.y = 24.3;
    group.add(beacon);
    group.userData.beacon = beacon;
    group.userData.lampRoom = lampRoom;

    const hut = box(7, 4, 5.5, 0xf2ece0, 6.5, 2, 1.5);
    group.add(hut);
    const hutRoof = new THREE.Mesh(new THREE.CylinderGeometry(0, 6.2, 2.2, 4), mat(0xd8382c));
    hutRoof.rotation.y = Math.PI / 4;
    hutRoof.position.set(6.5, 5.1, 1.5);
    hutRoof.scale.set(7 / 8.8, 1, 5.5 / 8.8);
    group.add(hutRoof);

    return group;
}

function buildHarbour() {
    const group = new THREE.Group();
    const woodTex = makeWoodTexture();
    woodTex.repeat.set(6, 2);
    const plank = mat(0xa9773f, { map: woodTex });

    /* Jetty running out from the shore into the bay. */
    const place = placeById("harbour");
    const outward = Math.atan2(place.z, place.x);
    const deckLength = 46;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, deckLength), plank);
    deck.castShadow = true;
    deck.receiveShadow = true;
    deck.position.set(0, 1.5, deckLength / 2);
    group.add(deck);

    for (let i = 0; i < 9; i += 1) {
        const z = 3 + i * 5.4;
        for (const side of [-1, 1]) {
            const pile = cylinder(0.34, 0.34, 8, 0x6d4a29, 8);
            pile.position.set(side * 2.4, -1.4, z);
            group.add(pile);
        }
    }

    const rail = new THREE.Group();
    for (let i = 0; i < 9; i += 1) {
        const z = 3 + i * 5.4;
        for (const side of [-1, 1]) {
            rail.add(box(0.18, 1.1, 0.18, 0x8a6134, side * 2.7, 2.3, z));
        }
    }
    for (const side of [-1, 1]) {
        rail.add(box(0.14, 0.14, deckLength, 0x8a6134, side * 2.7, 2.85, deckLength / 2));
    }
    group.add(rail);

    /* A boat, for scale and for something to rescue. */
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 5, 6, 12), mat(0xe8edf3));
    hull.rotation.x = Math.PI / 2;
    hull.scale.set(1, 1, 0.55);
    hull.castShadow = true;
    boat.add(hull);
    boat.add(box(2.2, 1.8, 2.6, 0x2f6fe0, 0, 1.3, -1.2));
    boat.add(cylinder(0.12, 0.12, 5, 0xd8dde3, 8).translateY(3.2).translateZ(0.6));
    boat.position.set(-6.5, 0.5, 26);
    boat.rotation.y = 0.3;
    group.add(boat);
    group.userData.boat = boat;

    group.rotation.y = -outward + Math.PI / 2;
    return group;
}

/* ---------------------------------------------------------------- *
 * Farm, forest, mountain
 * ---------------------------------------------------------------- */

function buildBarn() {
    const group = new THREE.Group();
    const body = box(16, 8, 11, 0xc0392b, 0, 4, 0);
    group.add(body);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 11.5, 5, 4), mat(0xf3e8d2));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 10.5;
    roof.scale.set(16 / 16.2, 1, 11 / 16.2);
    roof.castShadow = true;
    group.add(roof);
    group.add(box(5, 6, 0.3, 0xf3e8d2, 0, 3, 5.6));
    group.add(box(0.4, 6, 0.34, 0xc0392b, 0, 3, 5.75));
    group.add(box(5, 0.4, 0.34, 0xc0392b, 0, 3, 5.75));

    const silo = cylinder(2.6, 2.6, 13, 0xd6d9dd, 16);
    silo.position.set(11.5, 6.5, 2);
    group.add(silo);
    const siloCap = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x9aa3ab));
    siloCap.position.set(11.5, 13, 2);
    siloCap.castShadow = true;
    group.add(siloCap);

    /* Fences, and a windmill you can see from the coast road. */
    for (let i = -5; i <= 5; i += 1) {
        group.add(box(0.22, 1.5, 0.22, 0x9a7b4f, i * 4, 0.75, -14));
        group.add(box(4, 0.16, 0.14, 0x9a7b4f, i * 4 + 2, 1.15, -14));
        group.add(box(4, 0.16, 0.14, 0x9a7b4f, i * 4 + 2, 0.6, -14));
    }

    const mill = new THREE.Group();
    for (let i = 0; i < 4; i += 1) {
        const blade = box(0.9, 5.5, 0.12, 0xf3e8d2, 0, 2.75, 0);
        blade.rotation.z = (i / 4) * Math.PI * 2;
        blade.position.set(Math.sin((i / 4) * Math.PI * 2) * 2.75, Math.cos((i / 4) * Math.PI * 2) * 2.75, 0);
        mill.add(blade);
    }
    mill.position.set(-14, 11, 3);
    group.add(mill);
    group.add(cylinder(0.5, 1.1, 11, 0x8a6134, 8).translateX(-14).translateY(5.5).translateZ(3));
    group.userData.mill = mill;

    return group;
}

function buildLodge() {
    const group = new THREE.Group();
    group.add(box(14, 6, 10, 0x8a5a34, 0, 3, 0));
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 11, 5.4, 4), mat(0xf6fbff));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 8.4;
    roof.scale.set(14 / 15.6, 1, 10 / 15.6);
    roof.castShadow = true;
    group.add(roof);
    group.add(box(3, 4.2, 0.3, 0x5d3a20, 0, 2.1, 5.1));
    for (const side of [-1, 1]) {
        group.add(box(2, 1.6, 0.2, 0xffe9a8, side * 4.4, 3.6, 5.1, { emissive: 0xffd77a, emissiveIntensity: 0.4 }));
    }
    const chimney = box(1.6, 5, 1.6, 0x7a6a5a, -5, 8, -2);
    group.add(chimney);

    /* Stacked firewood and a couple of pines, so it reads as a mountain hut. */
    for (let i = 0; i < 6; i += 1) {
        const log = cylinder(0.28, 0.28, 3, 0x8a6134, 8);
        log.rotation.z = Math.PI / 2;
        log.position.set(8, 0.3 + (i % 3) * 0.58, -3 + Math.floor(i / 3) * 0.6);
        group.add(log);
    }
    return group;
}

function buildBridge() {
    const group = new THREE.Group();
    const bay = roads.find((r) => r.id === "bay");
    if (!bay) return group;

    const bridge = placeById("bridge");
    /* Find the stretch of Bay Road nearest the marked crossing. */
    let best = 0;
    let bestDistance = Infinity;
    bay.path.forEach(([x, z], i) => {
        const d = Math.hypot(x - bridge.x, z - bridge.z);
        if (d < bestDistance) {
            bestDistance = d;
            best = i;
        }
    });

    const span = 7;
    /* Just outside the carriageway, whatever the road happens to be. */
    const kerb = bay.width * 0.5 + 0.6;
    const from = bay.path[Math.max(0, best - span)];
    const to = bay.path[Math.min(bay.path.length - 1, best + span)];
    const midX = (from[0] + to[0]) / 2;
    const midZ = (from[1] + to[1]) / 2;
    const angle = Math.atan2(to[0] - from[0], to[1] - from[1]);
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const deckY = bay.heights[best];

    /* Railings only; the road ribbon is already the deck. */
    for (const side of [-1, 1]) {
        for (let i = 0; i <= 8; i += 1) {
            const t = i / 8;
            const post = box(0.24, 1.3, 0.24, 0xe8edf3, side * kerb, 0.65, (t - 0.5) * length);
            group.add(post);
        }
        group.add(box(0.2, 0.2, length, 0xd8382c, side * kerb, 1.25, 0));
        group.add(box(0.2, 0.2, length, 0xe8edf3, side * kerb, 0.7, 0));
        /* Deck edge, so it reads as a structure from below. */
        group.add(box(0.6, 1.1, length, 0xc8cfd7, side * kerb, -0.6, 0));
    }
    for (let i = -1; i <= 1; i += 2) {
        const pier = box(2, 12, 1.6, 0xc8cfd7, 0, -6.6, i * length * 0.24);
        group.add(pier);
    }

    group.position.set(midX, deckY, midZ);
    group.rotation.y = angle;
    return group;
}

/* Signposts at every junction, so the island can be navigated by looking
   rather than by opening the map. */
function buildSignposts() {
    const group = new THREE.Group();
    const canvasFor = (text, colour) => {
        const el = document.createElement("canvas");
        el.width = 256;
        el.height = 64;
        const ctx = el.getContext("2d");
        ctx.fillStyle = colour;
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(4, 4, 248, 56);
        ctx.fillStyle = colour;
        ctx.font = "bold 30px 'Segoe UI', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text.toUpperCase().slice(0, 16), 128, 34);
        const tex = new THREE.CanvasTexture(el);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
    };

    PLACES.filter((p) => p.kind !== "town").forEach((place) => {
        const post = new THREE.Group();
        post.add(cylinder(0.16, 0.2, 4.4, 0x8a6134, 8).translateY(2.2));
        const board = new THREE.Mesh(
            new THREE.BoxGeometry(4.4, 1.1, 0.16),
            new THREE.MeshLambertMaterial({ map: canvasFor(place.name, "#2f6fe0") })
        );
        board.position.set(1.6, 3.6, 0);
        board.castShadow = true;
        post.add(board);

        /* Try four spots around the landmark and take whichever is furthest
           from tarmac — a signpost standing in the carriageway is worse than
           no signpost. */
        let best = null;
        for (let i = 0; i < 8; i += 1) {
            const a = (i / 8) * Math.PI * 2;
            const sx = place.x + Math.cos(a) * 15;
            const sz = place.z + Math.sin(a) * 15;
            const score = roadInfluenceAt(sx, sz);
            if (!best || score < best.score) best = { x: sx, z: sz, score, a };
        }
        ground(post, best.x, best.z, Math.atan2(place.x - best.x, place.z - best.z));
        group.add(post);
    });

    return group;
}

/* ---------------------------------------------------------------- *
 * Assembly
 * ---------------------------------------------------------------- */

export function buildLandmarks() {
    const group = new THREE.Group();
    group.name = "landmarks";
    const animated = {};
    const solid = (x, z, radius, top) =>
        obstacles.add(x, z, radius, { kind: "building", restitution: 0.32, absorb: 0.45, top });

    const lookout = buildLookout();
    const lookoutPlace = placeById("lookout");
    /* Turn the badge to face the town, which is the direction almost everyone
       arrives from — it is the thing that makes the tower read as the Lookout
       rather than as a water tower. */
    const town = placeById("townsquare");
    ground(
        lookout,
        lookoutPlace.x,
        lookoutPlace.z,
        Math.atan2(town.x - lookoutPlace.x, town.z - lookoutPlace.z)
    );
    group.add(lookout);
    /* The tower only; the garage bays around it are meant to be driven at. */
    solid(lookoutPlace.x, lookoutPlace.z, 12, 46);

    group.add(buildTown());

    const lighthouse = buildLighthouse();
    const lp = placeById("lighthouse");
    ground(lighthouse, lp.x, lp.z, 2.2);
    group.add(lighthouse);
    solid(lp.x, lp.z, 4.4, 30);
    animated.lighthouse = lighthouse;

    const harbour = buildHarbour();
    const hp = placeById("harbour");
    ground(harbour, hp.x, hp.z);
    group.add(harbour);
    animated.harbour = harbour;

    const barn = buildBarn();
    const fp = placeById("farm");
    const bx = fp.x - 24;
    const bz = fp.z - 16;
    ground(barn, bx, bz, 0.6);
    group.add(barn);
    solid(bx, bz, 9, 14);
    solid(bx + Math.cos(0.6) * 11.5 - Math.sin(0.6) * 2, bz + Math.sin(0.6) * 11.5 + Math.cos(0.6) * 2, 2.8, 14);
    animated.mill = barn.userData.mill;

    const lodge = buildLodge();
    const lo = placeById("lodge");
    ground(lodge, lo.x - 16, lo.z + 12, 1.2);
    group.add(lodge);
    solid(lo.x - 16, lo.z + 12, 8, 12);

    const hall = placeById("cityhall");
    solid(hall.x, hall.z, 11, 20);
    const square = placeById("townsquare");
    solid(square.x - 16, square.z + 18, 4.6, 4);

    group.add(buildBridge());
    group.add(buildSignposts());

    group.userData.animated = animated;
    return group;
}

export { buildLookout, buildHouse };

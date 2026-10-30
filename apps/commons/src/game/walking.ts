import { createBody, createWalker, judgeStep, octStep, passability, stepBody, stepTime } from '../shared';
import type { InputFrame } from '../input/types';
import type { WorldState } from '../net/world';

/*
 * Walking, the way the browser does it (src/arcade/Commons.js), kept apart
 * from the screen so it can be tested with no GL and no React.
 *
 * Three things are in play, and they are not the same thing:
 *
 * - the BODY: where the character is drawn, on a continuous plane. It moves
 *   smoothly where the stick points (src/world/motion.js), at frame rate,
 *   and is blocked by solid tiles.
 * - the WALKER: the app's belief about which TILE the server has you on,
 *   with the steps still in flight (src/arcade/ascii3d/prediction.js). The
 *   server only ever hears one-tile steps.
 * - the SERVER's snapshot, which arrives a beat behind both.
 *
 * Each frame the body moves; when it crosses into a new tile a step is sent;
 * when an answer or a snapshot disagrees with the walker, the walker is
 * corrected, and if the body has drifted more than a tile from the corrected
 * tile it is snapped back. So a laggy connection rubber-bands gently instead
 * of letting you walk through a wall the server knows is there.
 */

/* The browser's step beat (src/arcade/Commons.js). The server enforces its own. */
export const STEP_MS = 150;

/* Below this a stick is resting, not leaning (a worn thumbstick drifts). */
const DEAD_ZONE = 0.15;

/* How far the body may be from where the server says before it is snapped. */
const SNAP_DISTANCE = 0.9;

type Nav = ReturnType<typeof passability>;
type Tile = { x: number; y: number };
export type Me = NonNullable<WorldState['me']>;

/* Tells the server about one step. Resolves with where the server put you
   (or null if it didn't say), rejects if the call failed. */
export type SendStep = (dx: number, dy: number) => Promise<Tile | null>;

export type Walking = ReturnType<typeof createWalking>;

export function createWalking(
  sendStep: SendStep,
  hooks: {
    /* A step failed to reach the server. */
    onInterrupted?: () => void;
    clock?: () => number;
  } = {},
) {
  const clock = hooks.clock ?? Date.now;
  const walker = createWalker();
  let body: ReturnType<typeof createBody> | null = null;
  let nav: Nav | null = null;
  /* Earliest time the next step may go out; spaces steps at the beat. */
  let nextStepAt = 0;

  /* Put the body on a tile, still. */
  const place = (at: Tile) => {
    if (!body) return;
    body.x = at.x;
    body.y = at.y;
    body.vx = 0;
    body.vy = 0;
  };

  const farFromBody = (at: Tile) => !!body && Math.max(Math.abs(body.x - at.x), Math.abs(body.y - at.y)) > SNAP_DISTANCE;

  /* Send one step and square the walker with the answer. */
  const send = (dx: number, dy: number, moved: boolean) => {
    const ticket = walker.send(dx, dy, moved);
    const settle = (at: Tile | null) => {
      if (walker.ack(ticket, at) && walker.position && farFromBody(walker.position)) place(walker.position);
    };
    sendStep(dx, dy)
      .then((at) => settle(at && typeof at === 'object' ? at : null))
      .catch(() => {
        settle(null);
        hooks.onInterrupted?.();
      });
  };

  return {
    /* The body to draw; null until the first snapshot with you in it. */
    get body() {
      return body;
    },
    get position(): Tile | null {
      return walker.position;
    },

    /*
     * A snapshot from the server: rebuild what is solid, and square the
     * walker with where you are. The first one puts the body on the map.
     */
    sync(state: WorldState) {
      nav = passability(state);
      const me = state.me;
      if (!me) return;
      if (!body) {
        body = createBody(me.x, me.y);
        walker.reset(me);
        return;
      }
      /* Dead, you are wherever the server says: nothing is in flight. */
      if (me.hp <= 0) walker.reset(me);
      else if (!walker.sync(me)) return;
      const at = walker.position;
      if (at && farFromBody(at)) place(at);
    },

    /* The tile in front of you, for gathering, digging and building. */
    facingTile(): Tile | null {
      const here = walker.position;
      if (!body || !here) return null;
      const [dx, dy] = octStep([Math.sin(body.facing), Math.cos(body.facing)]);
      return { x: here.x + dx, y: here.y + dy };
    },

    /*
     * One frame of walking. `input` is the hub's frame (a stick in screen
     * terms, y up); `alive` is false while you are down, which freezes the
     * body without losing the stick.
     */
    advance(dt: number, input: Pick<InputFrame, 'move' | 'held'>, alive: boolean) {
      if (!body || !nav) return;
      const open = nav;

      /* Screen to map. The camera sits off the +x,+y corner looking back,
         so screen-up is map (-1,-1) and screen-right is map (1,-1). */
      const sx = alive ? input.move.x : 0;
      const sy = alive ? input.move.y : 0;
      const want: [number, number] = [(sx - sy) / Math.SQRT2, (-sx - sy) / Math.SQRT2];
      if (Math.hypot(want[0], want[1]) < DEAD_ZONE) {
        want[0] = 0;
        want[1] = 0;
      }
      stepBody(body, want, input.held.has('run'), dt, (x: number, y: number) => !open.open(x, y));

      /* Tell the server about each tile the body has crossed into. */
      const here = walker.position;
      const now = clock();
      if (!here || !walker.ready || now < nextStepAt) return;
      const dx = Math.sign(Math.round(body.x) - here.x);
      const dy = Math.sign(Math.round(body.y) - here.y);
      if (!dx && !dy) return;

      let step: [number, number] = [dx, dy];
      let judged = judgeStep(open, here, dx, dy);
      /* A diagonal around a corner is two straight steps: take whichever
         is open now and let the next frame take the other. */
      if (dx && dy && judged.cornered) {
        step = open.open(here.x + dx, here.y) ? [dx, 0] : [0, dy];
        judged = judgeStep(open, here, step[0], step[1]);
      }
      nextStepAt = now + stepTime(step[0], step[1], STEP_MS);
      send(step[0], step[1], judged.moved);
      /* Someone is in the way: the body stays on the tile it had. */
      if (!judged.moved && !judged.creature) place(here);
    },
  };
}

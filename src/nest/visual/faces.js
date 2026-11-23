/* Emotion, action and reaction faces. Numbers drive the motion loop,
   strings pick mouth, brows and floating extras. */

const NEUTRAL = {
  lidTop: 0.12, lidBottom: 0, lidAsym: 0, slant: 0, eyeScale: 1, pupil: 1,
  mouth: 'smile', blush: 0.2, brow: null, ears: 0, earsAsym: 0, bounce: 0.7,
  tilt: 0, lean: 0, sink: 0, stretch: 0, look: null, extra: null, wag: false, sway: 1,
};

export const EMOTION_FACES = {
  joy: { lidTop: 0, lidBottom: 0.42, pupil: 1.12, mouth: 'grin', blush: 0.55, ears: -12, bounce: 1.7, extra: 'sparkles', wag: true },
  calm: { lidTop: 0.28, lidBottom: 0.1, mouth: 'smile', blush: 0.28, ears: 4, bounce: 0.55, sway: 0.7 },
  curious: { lidTop: 0, eyeScale: 1.1, pupil: 1.22, mouth: 'o', blush: 0.15, brow: 'up', ears: -16, earsAsym: 12, tilt: 10, bounce: 0.9, extra: 'question' },
  sleepy: { lidTop: 0.6, lidBottom: 0.12, mouth: 'flat', blush: 0.22, ears: 26, bounce: 0.2, sway: 0.5, sink: 2, extra: 'drowse' },
  grumpy: { lidTop: 0.4, slant: 17, mouth: 'frown', blush: 0, brow: 'angry', ears: 36, bounce: 0.25, extra: 'cloud', stretch: -0.03 },
  shy: { lidTop: 0.24, lidBottom: 0.12, mouth: 'wobble', blush: 1, ears: 20, bounce: 0.35, lean: -6, look: [-0.6, 0.55], extra: 'blushlines' },
  mischievous: { lidTop: 0.44, lidAsym: -0.34, slant: 9, mouth: 'smirk', blush: 0.2, brow: 'one', ears: -6, earsAsym: -10, bounce: 0.9, look: [0.65, -0.05], extra: 'glint' },
  sad: { lidTop: 0.32, slant: -19, mouth: 'frown', blush: 0, brow: 'sad', ears: 40, bounce: 0.12, sink: 4, stretch: -0.04, look: [0, 0.45], extra: 'tear' },
  surprised: { lidTop: 0, eyeScale: 1.2, pupil: 0.6, mouth: 'O', blush: 0, brow: 'high', ears: -24, bounce: 0.7, stretch: 0.06, extra: 'bang' },
  affectionate: { lidTop: 0.32, lidBottom: 0.52, mouth: 'cat', blush: 0.9, ears: 8, bounce: 0.8, extra: 'hearts', wag: true },
};

export const ACTION_FACES = {
  bounce: { lidBottom: 0.35, mouth: 'grin', extra: 'sparkles' },
  spin: { lidBottom: 0.3, mouth: 'grin' },
  wiggle: { lidBottom: 0.3, mouth: 'grin', wag: true },
  nuzzle: { lidTop: 0.4, lidBottom: 0.55, mouth: 'cat', blush: 0.85, extra: 'hearts' },
  yawn: { lidTop: 0.82, lidBottom: 0.2, mouth: 'yawn', brow: null, ears: 20, extra: null },
  stare: { lidTop: 0, lidBottom: 0, eyeScale: 1.1, pupil: 0.72, mouth: 'flat', brow: null, extra: null, look: [0, 0] },
  hide: { lidTop: 0.9, lidBottom: 0.2, mouth: 'wobble', blush: 0.9, ears: 42, extra: null },
  tilt: { tilt: 15, brow: 'up' },
};

export const REACTION_FACES = {
  flinch: { lidTop: 0.78, lidBottom: 0.4, slant: 12, mouth: 'o', blush: 0.15, brow: null, ears: 30, extra: 'bang' },
  giggle: { lidTop: 0.34, lidBottom: 0.58, mouth: 'laugh', blush: 0.85, extra: 'sparkles', wag: true },
  purr: { lidTop: 0.42, lidBottom: 0.56, mouth: 'cat', blush: 0.75, ears: 14, extra: 'hearts' },
  nuzzle: { lidTop: 0.45, lidBottom: 0.55, mouth: 'smile', blush: 0.95, extra: 'hearts', ears: 10 },
};

const SLEEP_FACE = { lidTop: 1, lidBottom: 0, slant: 0, mouth: 'sleep', blush: 0.32, brow: null, ears: 30, bounce: 0, extra: 'zzz', look: [0, 0.2] };

export function faceFor({ emotion, action, actionActive, reaction, asleep }) {
  let face = { ...NEUTRAL, ...(EMOTION_FACES[emotion] || EMOTION_FACES.calm) };
  if (asleep) {
    face = { ...face, ...SLEEP_FACE };
    if (reaction === 'giggle' || reaction === 'purr' || reaction === 'nuzzle') face = { ...face, mouth: 'cat', blush: 0.6 };
    if (reaction === 'flinch') face = { ...face, lidTop: 0.8, mouth: 'o' };
    return face;
  }
  if (action && action !== 'none' && actionActive && ACTION_FACES[action]) face = { ...face, ...ACTION_FACES[action] };
  if (reaction && REACTION_FACES[reaction]) face = { ...face, ...REACTION_FACES[reaction] };
  return face;
}

/* How long each action plays; 0 means it holds while the action is set. */
export const ACTION_DURATION = { bounce: 1.5, spin: 1.1, wiggle: 1.3, nuzzle: 2.2, yawn: 2.4, tilt: 0, stare: 0, hide: 0, none: 0 };

/* Nest visual layer: pure React components driven by the Phenotype,
   CreaturePose and Scene contracts (docs/nest-design.md §10). */

import './nest-visual.css';

export { default as Creature } from './Creature';
export { default as Egg } from './Egg';
export { default as HatchSequence } from './HatchSequence';
export { default as Habitat, STAGE, SLOTS } from './Habitat';
export { WorldWindow, JournalBook, MemoryJars, SettingsKey, TrinketIcon, trinketKind } from './objects';
export { createVoice, useVoice } from './sound';
export { phenotypeRandom, validatePhenotype, DEFAULT_POSE, STAGES, EMOTIONS, ACTIONS, FEATURES, WEATHERS } from './phenotype';
export { createGestureClassifier, useGestureHandlers, GESTURE_TIMING } from './gestures';
export { skyAt, moonPhaseFor, moonPath, moonIllumination } from './sky';
export { useNestFonts } from './fonts';
export { usePrefersReducedMotion } from './motion';

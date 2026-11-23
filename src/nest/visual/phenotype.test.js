import { phenotypeRandom, validatePhenotype, STAGES, FEATURES } from './phenotype';

test('phenotypeRandom is valid for 500 seeds across every stage', () => {
  for (let i = 0; i < 500; i++) {
    const stage = STAGES[i % STAGES.length];
    const p = phenotypeRandom(`seed-${i}`, stage);
    const errors = validatePhenotype(p);
    if (errors.length) throw new Error(`seed-${i} ${stage}: ${errors.join(', ')}`);
  }
});

test('every stage of one seed is valid and the same creature grows up', () => {
  for (let i = 0; i < 80; i++) {
    const lives = STAGES.map((stage) => phenotypeRandom(`life-${i}`, stage));
    lives.forEach((p) => expect(validatePhenotype(p)).toEqual([]));
    const shapes = new Set(lives.map((p) => p.body.shape));
    expect(shapes.size).toBe(1);
    // features only accumulate (elder may add whiskers)
    for (let s = 2; s < lives.length; s++) {
      lives[s - 1].features.forEach((f) => expect(lives[s].features).toContain(f));
    }
    expect(lives[1].size).toBeLessThan(lives[5].size);
  }
});

test('random phenotypes reach every branch of the contract', () => {
  const seen = { shape: new Set(), ears: new Set(), tail: new Set(), pattern: new Set(), features: new Set(), eye: new Set(), mark: new Set() };
  for (let i = 0; i < 500; i++) {
    const p = phenotypeRandom(`branch-${i}`, i % 2 ? 'adult' : 'elder');
    seen.shape.add(p.body.shape);
    seen.ears.add(p.body.ears);
    seen.tail.add(p.body.tail);
    seen.pattern.add(p.pattern);
    p.features.forEach((f) => seen.features.add(f));
    seen.eye.add(p.eyes.shape);
    p.marks.forEach((m) => seen.mark.add(m.kind));
  }
  expect(seen.shape.size).toBe(4);
  expect(seen.ears.size).toBe(6);
  expect(seen.tail.size).toBe(5);
  expect(seen.pattern.size).toBe(5);
  expect(seen.features.size).toBe(FEATURES.length);
  expect(seen.eye.size).toBe(4);
  expect(seen.mark.size).toBe(6);
});

test('eggs carry warmth and cracks; options override features', () => {
  const egg = phenotypeRandom('egg-1', 'egg', { egg: { warmth: 0.9, cracks: 0.4 } });
  expect(egg.egg).toEqual({ warmth: 0.9, cracks: 0.4 });
  const custom = phenotypeRandom('x', 'adult', { features: ['wings', 'horns', 'nope', 'wings'] });
  expect(custom.features).toEqual(['wings', 'horns']);
  expect(validatePhenotype(custom)).toEqual([]);
});

test('validatePhenotype catches broken shapes', () => {
  const p = phenotypeRandom('bad', 'adult');
  expect(validatePhenotype({ ...p, stage: 'teen' })).toContain('stage');
  expect(validatePhenotype({ ...p, palette: { ...p.palette, body: 'red' } })).toContain('palette.body');
  expect(validatePhenotype({ ...p, features: ['laser'] })).toContain('features');
  expect(validatePhenotype({ ...p, egg: { warmth: 1, cracks: 0 } })).toContain('egg only for stage egg');
});

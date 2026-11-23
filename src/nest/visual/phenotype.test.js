import { phenotypeRandom, validatePhenotype, normalizePhenotype, STAGES, FEATURES } from './phenotype';

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

test('normalizePhenotype leaves a valid phenotype untouched and is idempotent', () => {
  for (const stage of STAGES) {
    const p = phenotypeRandom('norm-ok', stage);
    expect(normalizePhenotype(p)).toBe(p);
  }
});

test('normalizePhenotype fills in anything missing so the result is valid', () => {
  const broken = [
    null,
    undefined,
    {},
    { seed: 'x', stage: 'adult' },
    { seed: 'x', stage: 'teen', size: 'big', body: { shape: 'cube' }, palette: { body: 'red' }, eyes: {}, features: ['laser', 'wings', 'wings'], marks: [null, { kind: 'zap', x: 4 }] },
    { ...phenotypeRandom('half', 'juvenile'), palette: undefined, eyes: { shape: 'round' }, gait: null, marks: undefined },
    { ...phenotypeRandom('egg-half', 'egg'), egg: undefined },
  ];
  for (const p of broken) {
    const n = normalizePhenotype(p);
    expect(validatePhenotype(n)).toEqual([]);
    expect(normalizePhenotype(n)).toBe(n);
  }
});

test('normalizePhenotype keeps the valid parts of a damaged phenotype', () => {
  const p = phenotypeRandom('keep', 'adult');
  const n = normalizePhenotype({ ...p, palette: undefined, eyes: { size: 0.9, shape: 'wide' } });
  expect(n.seed).toBe(p.seed);
  expect(n.body).toEqual(p.body);
  expect(n.eyes).toMatchObject({ size: 0.9, shape: 'wide', spacing: 0.5 });
  expect(n.palette.body).toMatch(/^#[0-9a-f]{6}$/i);
});

test('validatePhenotype reports, not throws, for non-array marks and features', () => {
  const base = phenotypeRandom('guard', 'adult');
  for (const bad of [{}, 'x', 5, null]) {
    expect(() => validatePhenotype({ ...base, marks: bad })).not.toThrow();
    expect(validatePhenotype({ ...base, marks: bad })).toContain('marks');
    expect(() => validatePhenotype({ ...base, features: bad })).not.toThrow();
    expect(() => normalizePhenotype({ ...base, marks: bad, features: bad })).not.toThrow();
    expect(Array.isArray(normalizePhenotype({ ...base, marks: bad }).marks)).toBe(true);
  }
});

import { describe, expect, it } from "vitest";
import {
  bumpStats,
  statOf,
  QUESTS,
  CHAPTERS,
  questStatus,
  planClaim,
  rewardLabel,
  CREATURES,
  DAY_ORDER,
  creatureStep,
  flees,
  sidesteps,
  biteFor,
  pickSpawn,
  lootFor,
  swingFor,
  PROJECTS,
  CONTRIBUTE_MAX,
  activeProject,
  planContribution,
  projectFraction,
  worldEffects,
  phaseChange,
  survivorsOf,
  isNight,
} from "../src/lib/game";
import { ITEMS, RECIPES, TOOL_NAMES } from "../src/lib/survival";

/* A fixed sequence of "random" numbers, repeating. */
const rolls = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("stats", () => {
  it("adds changes and ignores zero or broken ones", () => {
    const before = { "gather:wood": 3 };
    const after = bumpStats(before, {
      "gather:wood": 6,
      nights: 1,
      cook: 0,
      bad: NaN,
    });
    expect(after).toEqual({ "gather:wood": 9, nights: 1 });
    expect(before).toEqual({ "gather:wood": 3 });
    expect(bumpStats(undefined, { dig: 1 })).toEqual({ dig: 1 });
  });

  it("credits what a veteran did before counters existed", () => {
    const veteran = { kills: 40, gathered: 12, placed: 7, stats: {} };
    expect(statOf(veteran, "kill:any")).toBe(40);
    expect(statOf(veteran, "gather:any")).toBe(12);
    expect(statOf(veteran, "build:any")).toBe(7);
    expect(statOf({ kills: 1, stats: { "kill:any": 5 } }, "kill:any")).toBe(5);
    expect(statOf(null, "nights")).toBe(0);
  });
});

describe("quests", () => {
  it("is a well-formed chain", () => {
    const ids = new Set(QUESTS.map((q) => q.id));
    expect(ids.size).toBe(QUESTS.length);
    for (const quest of QUESTS) {
      expect(CHAPTERS[quest.chapter]).toBeTruthy();
      expect(quest.objectives.length).toBeGreaterThan(0);
      expect(quest.reward.xp).toBeGreaterThan(0);
      for (const item of Object.keys(quest.reward.items || {}))
        expect(ITEMS).toHaveProperty(item);
      for (const o of quest.objectives)
        if ("tool" in o) expect(TOOL_NAMES).toHaveProperty(o.tool);
    }
    /* Chapters never go backwards. */
    const chapters = QUESTS.map((q) => q.chapter);
    expect([...chapters].sort((a, b) => a - b)).toEqual(chapters);
  });

  it("reports progress per objective, capped at what is needed", () => {
    const status = questStatus({ quest: 0, stats: { "gather:wood": 30, "gather:stone": 2 } });
    expect(status.quest?.id).toBe("kindling");
    expect(status.chapter).toBe("First light");
    expect(status.progress).toEqual([
      { label: "Wood", have: 12, need: 12, done: true },
      { label: "Stone", have: 2, need: 6, done: false },
    ]);
    expect(status.complete).toBe(false);
  });

  it("reads tools and a home as well as counters", () => {
    const tools = questStatus({ quest: 1, tools: { axe: 2, pick: 1 } });
    expect(tools.complete).toBe(true);
    const home = questStatus({
      quest: 5,
      home: { x: 1, y: 1 },
      stats: { "build:wall": 6, "build:door": 1 },
    });
    expect(home.quest?.id).toBe("homestead");
    expect(home.complete).toBe(true);
    expect(questStatus({ quest: 5, stats: { "build:wall": 6, "build:door": 1 } }).complete).toBe(false);
  });

  it("claims only a finished task, and says what is missing", () => {
    expect(planClaim(null).error).toBe("wake up first");
    expect(planClaim({ hp: 0 }).error).toBe("wake up first");
    expect(planClaim({ hp: 10, quest: 0, stats: { "gather:wood": 12 } }).error).toBe(
      "not yet: stone 0/6",
    );
    const plan = planClaim({ hp: 10, quest: 0, stats: { "gather:wood": 12, "gather:stone": 6 } });
    expect(plan.error).toBeUndefined();
    if (plan.error === undefined) {
      expect(plan.next).toBe(1);
      expect(plan.reward).toBe(QUESTS[0].reward);
      expect(plan.message).toBe("Kindling complete · +20 xp · +3 berries · +4 fiber");
    }
  });

  it("ends when the road is walked", () => {
    const end = questStatus({ quest: QUESTS.length });
    expect(end.quest).toBeNull();
    expect(end.complete).toBe(false);
    expect(planClaim({ hp: 5, quest: QUESTS.length }).error).toMatch(/every task is done/);
  });

  it("labels rewards", () => {
    expect(rewardLabel({ xp: 5, gold: 2, potions: 2, items: { meal: 1 } })).toBe(
      "+5 xp · +2 gold · +2 potions · +1 meal",
    );
  });
});

describe("creatures", () => {
  const at = { x: 0, y: 0, hp: 10, maxHp: 10 };

  it("chases along one axis toward someone in range", () => {
    expect(
      creatureStep({ ...at, kind: "kobold", target: { x: 3, y: 2 }, distance: 3.6, night: false, rng: rolls(0.9) }),
    ).toEqual({ dx: 1, dy: 0 });
    expect(
      creatureStep({ ...at, kind: "kobold", target: { x: 3, y: 2 }, distance: 3.6, night: false, rng: rolls(0.1) }),
    ).toEqual({ dx: 0, dy: 1 });
  });

  it("notices from further off by temper and by night", () => {
    const far = { ...at, target: { x: 7, y: 0 }, distance: 7, rng: rolls(0.9) };
    expect(creatureStep({ ...far, kind: "kobold", night: false })).toEqual({ dx: 0, dy: 0 });
    expect(creatureStep({ ...far, kind: "kobold", night: true })).toEqual({ dx: 1, dy: 0 });
    expect(creatureStep({ ...far, kind: "wolf", night: false })).toEqual({ dx: 1, dy: 0 });
    const veryFar = { ...at, target: { x: 9, y: 0 }, distance: 9, rng: rolls(0.9), night: true };
    expect(creatureStep({ ...veryFar, kind: "shade" })).toEqual({ dx: 1, dy: 0 });
  });

  it("runs when a rat is badly hurt", () => {
    expect(
      creatureStep({ ...at, hp: 3, kind: "rat", target: { x: 2, y: 0 }, distance: 2, night: false, rng: rolls(0.9) }),
    ).toEqual({ dx: -1, dy: 0 });
    /* Straight away from it, whatever the roll. */
    expect(
      creatureStep({ ...at, hp: 3, kind: "rat", target: { x: 1, y: 0 }, distance: 1, night: false, rng: rolls(0.1) }),
    ).toEqual({ dx: -1, dy: 0 });
    expect(flees({ kind: "rat", hp: 3, maxHp: 8 })).toBe(true);
    expect(flees({ kind: "rat", hp: 4, maxHp: 8 })).toBe(false);
    expect(flees({ kind: "kobold", hp: 1, maxHp: 18 })).toBe(false);
  });

  it("offers both sides of a blocked retreat", () => {
    expect(sidesteps({ dx: 1, dy: 0 }, rolls(0.1))).toEqual([{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }]);
    expect(sidesteps({ dx: 0, dy: -1 }, rolls(0.9))).toEqual([{ dx: -1, dy: 0 }, { dx: 1, dy: 0 }]);
  });

  it("is slow when it is a troll", () => {
    const troll = { ...at, kind: "troll", target: { x: 2, y: 0 }, distance: 2, night: false };
    expect(creatureStep({ ...troll, rng: rolls(0.2) })).toEqual({ dx: 0, dy: 0 });
    expect(creatureStep({ ...troll, rng: rolls(0.9) })).toEqual({ dx: 1, dy: 0 });
  });

  it("keeps a shade off someone carrying a lantern", () => {
    const step = creatureStep({
      ...at,
      kind: "shade",
      target: { x: 2, y: 0, lantern: true },
      distance: 2,
      night: true,
      rng: rolls(0.9),
    });
    expect(step).toEqual({ dx: 0, dy: 0 });
  });

  it("ambles when nobody is near", () => {
    expect(creatureStep({ ...at, kind: "kobold", target: null, distance: Infinity, night: false, rng: rolls(0.1, 0.9) })).toEqual({ dx: 1, dy: 0 });
    expect(creatureStep({ ...at, kind: "kobold", target: null, distance: Infinity, night: false, rng: rolls(0.9) })).toEqual({ dx: 0, dy: 0 });
  });

  it("bites by level, armor, night, the beacon and a lantern", () => {
    const veteran = { level: 4, tools: {} };
    expect(biteFor("wolf", veteran, { night: false })).toBe(7);
    expect(biteFor("wolf", veteran, { night: true })).toBe(8);
    expect(biteFor("wolf", veteran, { night: true, soften: 0.75 })).toBe(6);
    expect(biteFor("wolf", { level: 4, tools: { armor: 2 } }, { night: false })).toBe(3);
    expect(biteFor("wolf", { level: 1, tools: {} }, { night: false })).toBe(5);
    expect(biteFor("shade", veteran, { night: true })).toBe(6);
    expect(biteFor("shade", { level: 4, tools: { lantern: 1 } }, { night: true })).toBe(3);
    expect(biteFor("rat", { level: 30, tools: { armor: 2 } }, { night: false })).toBe(1);
  });

  it("brings shades only at night, and newcomers meet the weakest", () => {
    expect(pickSpawn({ level: 1, night: false, rng: rolls(0.99) })).toBe("rat");
    expect(pickSpawn({ level: 10, night: false, rng: rolls(0.99) })).toBe("troll");
    expect(pickSpawn({ level: 5, night: true, rng: rolls(0.3) })).toBe("shade");
    expect(pickSpawn({ level: 1, night: true, rng: rolls(0.3, 0) })).toBe("rat");
    for (const kind of DAY_ORDER) expect(CREATURES[kind].night).toBeFalsy();
    expect(CREATURES.shade.night).toBe(true);
  });

  it("drops essence from shades and meat from beasts", () => {
    expect(lootFor("shade", rolls(0))).toEqual({ gold: 12, items: { essence: 1 }, potion: true });
    expect(lootFor("wolf", rolls(0.99))).toEqual({ gold: 35, items: { meat: 2 }, potion: false });
    expect(lootFor("rat", rolls(0.5)).items).toEqual({ meat: 1 });
  });

  it("swings harder with level and weapon", () => {
    expect(swingFor({ level: 1 }, rolls(0))).toBe(5);
    expect(swingFor({ level: 3, tools: { weapon: 2 } }, rolls(0.99))).toBe(20);
  });

  it("makes a lantern from what shades drop", () => {
    const lantern = RECIPES.find((r) => r.id === "lantern");
    expect(lantern?.cost).toHaveProperty("essence");
    expect(ITEMS).toHaveProperty("essence");
  });
});

describe("projects", () => {
  const [well, watchtower] = PROJECTS;

  it("are built one after another", () => {
    expect(activeProject({})?.key).toBe("well");
    expect(activeProject({ well: { done: true } })?.key).toBe("watchtower");
    expect(
      activeProject({ well: { done: true }, watchtower: { done: true }, beacon: { done: true } }),
    ).toBeNull();
    for (const p of PROJECTS)
      for (const item of Object.keys(p.need)) expect(ITEMS).toHaveProperty(item);
  });

  it("takes at most ten, and no more than is still needed", () => {
    const plan = planContribution({ project: well, progress: {}, item: "wood", have: 40, atCrossroads: true });
    expect(plan).toMatchObject({ amount: CONTRIBUTE_MAX, progress: { wood: 10 }, done: false });
    const topUp = planContribution({ project: well, progress: { wood: 147 }, item: "wood", have: 40, atCrossroads: true });
    expect(topUp).toMatchObject({ amount: 3, progress: { wood: 150 } });
    expect(planContribution({ project: well, progress: { wood: 150 }, item: "wood", have: 40, atCrossroads: true }).error).toBe(
      "enough wood for now",
    );
  });

  it("refuses away from the crossroads, unneeded supplies and an empty pack", () => {
    const base = { project: well, progress: {}, have: 5, atCrossroads: true };
    expect(planContribution({ ...base, item: "wood", atCrossroads: false }).error).toBe("bring it to the crossroads");
    expect(planContribution({ ...base, item: "crystal" }).error).toMatch(/needs no crystal/);
    expect(planContribution({ ...base, item: "wood", have: 0 }).error).toBe("you have no wood");
  });

  it("only takes supplies by their own names, not inherited ones", () => {
    const base = { project: well, progress: {}, have: 5, atCrossroads: true };
    ["constructor", "toString", "__proto__", "hasOwnProperty"].forEach((item) => {
      expect(planContribution({ ...base, item }).error).toBe(`the crossroads well needs no ${item}`);
      expect(planContribution({ ...base, project: null, item }).error).toBe("the stores take only wood, stone and fiber");
    });
  });

  it("keeps taking basic supplies into the stores once every project is finished", () => {
    const done = { project: null, progress: undefined, have: 25, atCrossroads: true };
    expect(planContribution({ ...done, item: "wood" })).toMatchObject({
      amount: CONTRIBUTE_MAX,
      stores: true,
      message: "gave 10 wood to the crossroads stores",
    });
    expect(planContribution({ ...done, item: "fiber", have: 4 })).toMatchObject({ amount: 4, stores: true });
    expect(planContribution({ ...done, item: "ingot" }).error).toBe("the stores take only wood, stone and fiber");
    expect(planContribution({ ...done, item: "stone", have: 0 }).error).toBe("you have no stone");
    expect(planContribution({ ...done, item: "wood", atCrossroads: false }).error).toBe("bring it to the crossroads");
  });

  it("finishes on the last hand-in", () => {
    const plan = planContribution({
      project: well,
      progress: { wood: 150, stone: 100, fiber: 25 },
      item: "fiber",
      have: 9,
      atCrossroads: true,
    });
    expect(plan).toMatchObject({ amount: 5, done: true });
    expect(plan.error === undefined && plan.message).toMatch(/finished/);
  });

  it("measures progress", () => {
    expect(projectFraction(watchtower, {})).toBe(0);
    expect(projectFraction(watchtower, { stone: 250, wood: 120, ingot: 12 })).toBe(1);
    expect(projectFraction(watchtower, { stone: 9999 })).toBeCloseTo(250 / 382);
  });

  it("changes the world once finished", () => {
    expect(worldEffects([])).toEqual({ regen: 0, nightSpawn: 5, nightBite: 1 });
    expect(worldEffects(["well", "watchtower", "beacon"])).toEqual({ regen: 1, nightSpawn: 2, nightBite: 0.75 });
  });
});

describe("day and night", () => {
  it("knows night", () => {
    expect(isNight("dusk")).toBe(true);
    expect(isNight("night")).toBe(true);
    expect(isNight("dawn")).toBe(false);
  });

  it("marks dusk and dawn once, and nothing on first sight", () => {
    expect(phaseChange(undefined, "night").event).toBeNull();
    expect(phaseChange("night", "night").event).toBeNull();
    expect(phaseChange("day", "dusk").event).toBe("dusk");
    expect(phaseChange("night", "dawn").event).toBe("dawn");
    expect(phaseChange("dusk", "dawn").event).toBe("dawn");
    expect(phaseChange("dawn", "day").event).toBeNull();
  });

  it("counts survivors out in the wild only", () => {
    const players = [
      { name: "out", hp: 5, x: 50, y: 0 },
      { name: "dead", hp: 0, x: 50, y: 0 },
      { name: "home", hp: 5, x: 0, y: 0 },
    ];
    const safe = (x: number, y: number) => Math.hypot(x, y) < 5;
    expect(survivorsOf(players, safe).map((p) => p.name)).toEqual(["out"]);
  });
});

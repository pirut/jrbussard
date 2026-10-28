import { meterLevel, conditionHint, buildCost, costText } from "./hud";

describe("meterLevel", () => {
  it("grades a meter by how full it is", () => {
    expect(meterLevel(30, 30)).toBe("ok");
    expect(meterLevel(12, 30)).toBe("low");
    expect(meterLevel(6, 30)).toBe("critical");
    expect(meterLevel(-4, 30)).toBe("critical");
  });
});

describe("conditionHint", () => {
  const healthy = { hp: 30, maxHp: 30, hunger: 90, warmth: 90 };
  it("says nothing when all is well, or when dead", () => {
    expect(conditionHint(healthy)).toBeNull();
    expect(conditionHint({ ...healthy, hp: 0 })).toBeNull();
    expect(conditionHint(null)).toBeNull();
  });
  it("puts health before hunger before cold", () => {
    expect(
      conditionHint({ ...healthy, hp: 5, hunger: 5, warmth: 5, potions: 1 }),
    ).toEqual({ level: "critical", text: "wounded · Q drinks a potion" });
    expect(conditionHint({ ...healthy, hunger: 30, warmth: 5 }).text).toBe(
      "hungry · E to eat",
    );
    expect(conditionHint({ ...healthy, warmth: 35 }).level).toBe("low");
  });
  it("does not offer a potion you do not have", () => {
    expect(conditionHint({ ...healthy, hp: 5 }).text).toBe(
      "wounded · get to safety",
    );
  });
});

describe("buildCost", () => {
  it("checks the price against what you carry", () => {
    expect(buildCost("wall", { wood: 1 })).toEqual({
      parts: [{ item: "wood", need: 2, have: 1 }],
      affordable: false,
    });
    expect(buildCost("wall", { wood: 2 }).affordable).toBe(true);
    expect(costText(buildCost("torch", {}).parts)).toBe("1 wood + 1 stone");
    expect(buildCost("nothing", {}).affordable).toBe(false);
  });
});

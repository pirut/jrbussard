// @ts-check
/*
 * The road: an ordered chain of tasks, each with a few objectives and a
 * reward that is claimed rather than handed out, so finishing one is a
 * moment. `player.quest` is the index of the task in hand; past the end,
 * the chain is done.
 *
 * Responsibility: the quest list, how far along an objective is, and the
 * decision whether the task in hand can be claimed and what it pays
 * (planClaim). It deliberately does not grant anything or count anything:
 * counters are bumped by the mutations (stats.js lists the keys), and
 * convex/game.ts claimQuest applies the reward and advances `player.quest`.
 *
 * Callers: convex/game.ts (planClaim); the browser's quest log and tracker
 * (src/arcade/commons/QuestLog.js, QuestTracker.js); and the native app via
 * apps/commons/src/shared.ts (QUESTS, CHAPTERS, questStatus, rewardLabel)
 * for its HUD and the claim button.
 *
 * Invariants:
 * - Dependency-free, deterministic plain JavaScript shared with the server
 *   and both clients. The server is authoritative: clients call questStatus
 *   only to draw progress and enable the button; claimQuest runs planClaim
 *   again on the stored player, and the client never names which quest it
 *   is claiming, so it cannot skip ahead.
 * - Order is identity. A player's `quest` is an index into QUESTS, so
 *   inserting or reordering entries (other than appending) moves everyone to
 *   a different task. Appending is safe: a player past the old end simply
 *   has a new task to do. `id` is for humans and tests; only the index is
 *   stored.
 * - Objectives read lifetime counters and current state, not progress since
 *   the task began. A task whose objectives are already met is claimable the
 *   moment it comes up, which is how veterans catch up quickly.
 */
import { statOf } from "./stats.js";

/**
 * @typedef {{ label: string, stat: string, count: number }
 *   | { label: string, tool: string, tier: number }
 *   | { label: string, home: true }} Objective
 * @typedef {{ xp: number, gold?: number, potions?: number, items?: Record<string, number> }} Reward
 * @typedef {{ id: string, chapter: number, title: string, detail: string,
 *   objectives: Objective[], reward: Reward }} Quest
 */

/* Chapter titles, indexed by a quest's `chapter` field. */
export const CHAPTERS = ["First light", "Hunter", "Settler", "Warden"];

/*
 * The chain, in order. Each `objectives` entry is one of three kinds:
 *   { stat, count }   a counter in player.stats reaching `count` (stats.js
 *                     says what each key counts: mostly units gained, so
 *                     "gather:wood" 12 is twelve wood, not twelve swings)
 *   { tool, tier }    the equipment slot holding at least `tier`
 *   { home: true }    a respawn point set by using a bedroll
 * `detail` is player-facing advice and mentions browser keys ("Craft (C)");
 * the native app shows the same text. Rewards: xp always, plus optional
 * gold, healing potions and items (ITEMS ids from survival.js).
 */
/** @type {Quest[]} */
export const QUESTS = [
  {
    id: "kindling",
    chapter: 0,
    title: "Kindling",
    detail: "Click trees and rocks to gather. Everything starts with wood and stone.",
    objectives: [
      { label: "Wood", stat: "gather:wood", count: 12 },
      { label: "Stone", stat: "gather:stone", count: 6 },
    ],
    reward: { xp: 20, items: { berries: 3, fiber: 4 } },
  },
  {
    id: "tools",
    chapter: 0,
    title: "Tools of the trade",
    detail: "Fiber grows in the grass. Craft (C) an axe and a pickaxe.",
    objectives: [
      { label: "Stone axe", tool: "axe", tier: 1 },
      { label: "Stone pickaxe", tool: "pick", tier: 1 },
    ],
    reward: { xp: 30, items: { fiber: 6 } },
  },
  {
    id: "fire",
    chapter: 0,
    title: "A fire against the dark",
    detail: "Build a campfire away from the crossroads and cook something on it.",
    objectives: [
      { label: "Campfire built", stat: "build:campfire", count: 1 },
      { label: "Meal cooked", stat: "cook", count: 1 },
    ],
    reward: { xp: 30, potions: 1 },
  },
  {
    id: "first_night",
    chapter: 0,
    title: "Greet the dawn",
    detail: "Be out in the wild, alive, when the sun comes up. Shades hunt at night; torchlight holds them off.",
    objectives: [{ label: "Nights survived", stat: "nights", count: 1 }],
    reward: { xp: 50, gold: 15, items: { meal: 1 } },
  },
  {
    id: "hunter",
    chapter: 1,
    title: "Thin the herd",
    detail: "Walk into a creature to strike it. A spear helps.",
    objectives: [{ label: "Creatures killed", stat: "kill:any", count: 6 }],
    reward: { xp: 60, items: { meal: 2 } },
  },
  {
    id: "homestead",
    chapter: 1,
    title: "Call it home",
    detail: "Use your own bedroll to set camp, and wall it in with a door you can shut.",
    objectives: [
      { label: "Camp set", home: true },
      { label: "Walls raised", stat: "build:wall", count: 6 },
      { label: "Door hung", stat: "build:door", count: 1 },
    ],
    reward: { xp: 60, potions: 1 },
  },
  {
    id: "iron",
    chapter: 1,
    title: "Into the iron age",
    detail: "Build a furnace. Ore and coal come from rocks once you have a pickaxe.",
    objectives: [{ label: "Ingots smelted", stat: "craft:smelt", count: 3 }],
    reward: { xp: 80, items: { coal: 3 } },
  },
  {
    id: "commons",
    chapter: 2,
    title: "For the commons",
    detail:
      "Carry supplies to the crossroads and give them to the project being built there. Once every project is finished, the crossroads stores take wood, stone and fiber.",
    objectives: [{ label: "Supplies given", stat: "contribute", count: 30 }],
    reward: { xp: 80, gold: 30 },
  },
  {
    id: "wolves",
    chapter: 2,
    title: "Wolf at the door",
    detail: "Grey wolves roam further out and notice you from further off.",
    objectives: [{ label: "Wolves killed", stat: "kill:wolf", count: 3 }],
    reward: { xp: 100, potions: 1, items: { meal: 1 } },
  },
  {
    id: "armed",
    chapter: 2,
    title: "Iron in hand",
    detail: "Forge an iron sword and iron armor at a workbench.",
    objectives: [
      { label: "Iron sword", tool: "weapon", tier: 2 },
      { label: "Iron armor", tool: "armor", tier: 2 },
    ],
    reward: { xp: 120, gold: 40 },
  },
  {
    id: "crystal",
    chapter: 3,
    title: "Beyond the familiar",
    detail: "Crystal grows in rock far from the crossroads. It takes an iron pickaxe.",
    objectives: [{ label: "Crystal mined", stat: "gather:crystal", count: 3 }],
    reward: { xp: 150, items: { ingot: 2 } },
  },
  {
    id: "long_night",
    chapter: 3,
    title: "The long night",
    detail: "Hunt shades and live to see three dawns. Their essence makes a warden's lantern.",
    objectives: [
      { label: "Shades killed", stat: "kill:shade", count: 5 },
      { label: "Nights survived", stat: "nights", count: 3 },
    ],
    reward: { xp: 200, potions: 2 },
  },
  {
    id: "troll",
    chapter: 3,
    title: "Troll-breaker",
    detail: "Moss trolls are slow and hit like a falling tree. Bring friends.",
    objectives: [{ label: "Moss troll killed", stat: "kill:troll", count: 1 }],
    reward: { xp: 250, gold: 100 },
  },
];

/**
 * How far along one objective is: `have` is clamped to `need` so progress
 * never reads past 100%. Stat objectives need `count`; tool objectives need
 * `tier` (a higher tier than asked counts); the home objective is 0 or 1.
 * @param {Objective} objective
 * @param {any} player
 * @returns {{ have: number, need: number, done: boolean }}
 */
export function objectiveProgress(objective, player) {
  let have = 0;
  let need = 1;
  if ("stat" in objective) {
    have = statOf(player, objective.stat);
    need = objective.count;
  } else if ("tool" in objective) {
    have = Math.min(player?.tools?.[objective.tool] || 0, objective.tier);
    need = objective.tier;
  } else if ("home" in objective) {
    have = player?.home ? 1 : 0;
  }
  have = Math.min(have, need);
  return { have, need, done: have >= need };
}

/**
 * The task in hand, how far along each objective is, and whether it can be
 * claimed. `quest` is null once the chain is finished, `progress` is then
 * empty, `complete` is false and `chapter` stays on the last one. `index` is
 * the stored position (clamped to a non-negative integer, so a player with
 * no `quest` field starts at 0) and `total` the length of the chain.
 * @param {any} player
 */
export function questStatus(player) {
  const index = Math.max(0, Math.floor(player?.quest || 0));
  const quest = QUESTS[index] || null;
  const progress = quest
    ? quest.objectives.map((o) => ({
        label: o.label,
        ...objectiveProgress(o, player),
      }))
    : [];
  return {
    index,
    total: QUESTS.length,
    quest,
    chapter: quest ? CHAPTERS[quest.chapter] : CHAPTERS[CHAPTERS.length - 1],
    progress,
    complete: Boolean(quest) && progress.every((p) => p.done),
  };
}

/**
 * Claim the task in hand. Returns what to add to the player, or an error the
 * client can show as is. Refuses when dead ("wake up first"), when the chain
 * is finished, or when an objective is short (naming the first one that is,
 * with its counts). On success `next` is the index to store, `reward` what to
 * grant and `message` the line for the player. It grants nothing itself.
 * @param {any} player
 * @returns {{ error: string } | { error?: undefined, quest: Quest, next: number,
 *   reward: Reward, message: string }}
 */
export function planClaim(player) {
  if (!player || player.hp <= 0) return { error: "wake up first" };
  const status = questStatus(player);
  if (!status.quest) return { error: "the road is walked: every task is done" };
  if (!status.complete) {
    const left = status.progress.find((p) => !p.done);
    return {
      error: `not yet: ${left ? `${left.label.toLowerCase()} ${left.have}/${left.need}` : "keep going"}`,
    };
  }
  const reward = status.quest.reward;
  return {
    quest: status.quest,
    next: status.index + 1,
    reward,
    message: `${status.quest.title} complete · ${rewardLabel(reward)}`,
  };
}

/**
 * A short "+50 xp · +15 gold · +1 meal" summary of a reward. Item names are
 * the raw ITEMS ids, not display names.
 * @param {Reward} reward
 * @returns {string}
 */
export function rewardLabel(reward) {
  const parts = [`+${reward.xp} xp`];
  if (reward.gold) parts.push(`+${reward.gold} gold`);
  if (reward.potions)
    parts.push(`+${reward.potions} potion${reward.potions > 1 ? "s" : ""}`);
  for (const [item, n] of Object.entries(reward.items || {}))
    parts.push(`+${n} ${item}`);
  return parts.join(" · ");
}

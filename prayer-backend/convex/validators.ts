import { v } from "convex/values";
export const role = v.union(v.literal("owner"),v.literal("leader"),v.literal("member"));
export const visibility = v.union(v.literal("group"),v.literal("leaders"));
export const status = v.union(v.literal("ongoing"),v.literal("answered"),v.literal("archived"));
export const category = v.union(v.literal("family"),v.literal("health"),v.literal("work"),v.literal("faith"),v.literal("other"));
export const entryKind = v.union(v.literal("update"),v.literal("reply"));

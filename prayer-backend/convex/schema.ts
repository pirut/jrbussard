import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { role, visibility, status, category, entryKind } from "./validators";
export default defineSchema({
 ...authTables,
 groups:defineTable({key:v.string(),name:v.string(),description:v.string(),meetingSchedule:v.string(),ownerId:v.id("users")}).index("by_key",["key"]),
 memberships:defineTable({groupId:v.id("groups"),userId:v.id("users"),role,active:v.boolean(),name:v.string(),notifications:v.boolean()}).index("by_userId",["userId"]).index("by_groupId_and_active",["groupId","active"]),
 invitations:defineTable({groupId:v.id("groups"),tokenHash:v.string(),createdBy:v.id("users"),createdAt:v.number(),expiresAt:v.number(),maxUses:v.number(),uses:v.number(),revoked:v.boolean()}).index("by_tokenHash",["tokenHash"]).index("by_groupId",["groupId"]),
 requests:defineTable({groupId:v.id("groups"),authorId:v.id("users"),title:v.string(),body:v.string(),category,visibility,status,createdAt:v.number(),updatedAt:v.number(),prayerCount:v.number(),latestUpdate:v.union(v.null(),v.object({body:v.string(),createdAt:v.number()})),checkInId:v.optional(v.id("checkIns")),deleted:v.boolean()}).index("by_groupId_and_status",["groupId","status"]).index("by_groupId_and_authorId_and_status",["groupId","authorId","status"]).searchIndex("search_title",{searchField:"title",filterFields:["groupId","status"]}),
 entries:defineTable({groupId:v.id("groups"),requestId:v.id("requests"),authorId:v.id("users"),kind:entryKind,body:v.string(),createdAt:v.number(),checkInId:v.optional(v.id("checkIns")),deleted:v.boolean()}).index("by_requestId",["requestId"]).index("by_requestId_and_kind",["requestId","kind"]).index("by_groupId_and_kind",["groupId","kind"]),
 prayers:defineTable({requestId:v.id("requests"),userId:v.id("users")}).index("by_requestId_and_userId",["requestId","userId"]),
 follows:defineTable({groupId:v.id("groups"),requestId:v.id("requests"),userId:v.id("users")}).index("by_requestId_and_userId",["requestId","userId"]).index("by_userId",["userId"]).index("by_requestId",["requestId"]),
 checkIns:defineTable({groupId:v.id("groups"),authorId:v.id("users"),prompt:v.string(),createdAt:v.number(),closesAt:v.optional(v.number()),open:v.boolean()}).index("by_groupId_and_open",["groupId","open"]),
 notifications:defineTable({groupId:v.id("groups"),userId:v.id("users"),kind:v.union(v.literal("update"),v.literal("reply"),v.literal("checkIn")),requestId:v.optional(v.id("requests")),checkInId:v.optional(v.id("checkIns")),createdAt:v.number(),readAt:v.optional(v.number()),unread:v.boolean()}).index("by_userId",["userId"]).index("by_userId_and_unread",["userId","unread"]),
});

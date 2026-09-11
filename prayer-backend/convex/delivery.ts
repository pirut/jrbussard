import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import {internal} from './_generated/api';
import {canRead,notify} from './access';
export const entry=internalMutation({args:{requestId:v.id('requests'),actorId:v.id('users'),kind:v.union(v.literal('update'),v.literal('reply')),cursor:v.union(v.null(),v.string())},returns:v.null(),handler:async(ctx,args)=>{
 const r=await ctx.db.get(args.requestId);if(!r||r.deleted)return null;
 const rows=await ctx.db.query('follows').withIndex('by_requestId',q=>q.eq('requestId',r._id)).paginate({cursor:args.cursor,numItems:50});
 for(const row of rows.page){if(row.userId===args.actorId)continue;const member=await ctx.db.query('memberships').withIndex('by_userId',q=>q.eq('userId',row.userId)).unique();if(member&&canRead(member,r))await notify(ctx,member,{kind:args.kind,requestId:r._id});}
 if(!rows.isDone)await ctx.scheduler.runAfter(0,internal.delivery.entry,{...args,cursor:rows.continueCursor});return null;
}});
export const checkIn=internalMutation({args:{checkInId:v.id('checkIns'),actorId:v.id('users'),cursor:v.union(v.null(),v.string())},returns:v.null(),handler:async(ctx,args)=>{
 const c=await ctx.db.get(args.checkInId);if(!c||!c.open||(c.closesAt!==undefined&&c.closesAt<=Date.now()))return null;
 const rows=await ctx.db.query('memberships').withIndex('by_groupId_and_active',q=>q.eq('groupId',c.groupId).eq('active',true)).paginate({cursor:args.cursor,numItems:50});
 for(const member of rows.page)if(member.userId!==args.actorId)await notify(ctx,member,{kind:'checkIn',checkInId:c._id});
 if(!rows.isDone)await ctx.scheduler.runAfter(0,internal.delivery.checkIn,{...args,cursor:rows.continueCursor});return null;
}});
export const cleanup=internalMutation({args:{requestId:v.id('requests')},returns:v.null(),handler:async(ctx,args)=>{
 const r=await ctx.db.get(args.requestId);if(!r?.deleted)return null;
 const entries=await ctx.db.query('entries').withIndex('by_requestId',q=>q.eq('requestId',r._id)).take(100);
 const follows=await ctx.db.query('follows').withIndex('by_requestId',q=>q.eq('requestId',r._id)).take(100);
 const prayers=await ctx.db.query('prayers').withIndex('by_requestId_and_userId',q=>q.eq('requestId',r._id)).take(100);
 for(const row of [...entries,...follows,...prayers])await ctx.db.delete(row._id);
 if(entries.length===100||follows.length===100||prayers.length===100)await ctx.scheduler.runAfter(0,internal.delivery.cleanup,args);
 return null;
}});

import {ConvexError} from 'convex/values';
import {getAuthUserId} from '@convex-dev/auth/server';
import {customQuery,customMutation,customCtx} from 'convex-helpers/server/customFunctions';
import {RateLimiter,MINUTE} from '@convex-dev/rate-limiter';
import {query,mutation} from './_generated/server';
import type {QueryCtx,MutationCtx} from './_generated/server';
import type {Doc,Id} from './_generated/dataModel';
import {components} from './_generated/api';
export const limiter=new RateLimiter(components.rateLimiter,{write:{kind:'token bucket',rate:30,period:MINUTE,capacity:30},invite:{kind:'token bucket',rate:10,period:MINUTE,capacity:10}});
export function fail(message:string):never{throw new ConvexError(message)}
export function clean(value:string,label:string,max:number,min=1){const s=value.trim();if(s.length<min||s.length>max)fail(`${label} must be between ${min} and ${max} characters.`);return s;}
export async function memberContext(ctx:QueryCtx){
 const userId=await getAuthUserId(ctx);if(!userId)fail('Please sign in.');
 const member=await ctx.db.query('memberships').withIndex('by_userId',q=>q.eq('userId',userId)).unique();
 if(!member?.active)fail('An active group invitation is required.');
 const group=await ctx.db.get(member.groupId);if(!group)fail('Group unavailable.');
 return {userId,member,group};
}
export const memberQuery=customQuery(query,customCtx(memberContext));
export const memberMutation=customMutation(mutation,customCtx(async(ctx)=>{
 const result=await memberContext(ctx);await limiter.limit(ctx,'write',{key:result.userId,throws:true});return result;
}));
export type MemberCtx=QueryCtx&Awaited<ReturnType<typeof memberContext>>;
export function leader(ctx:Pick<MemberCtx,'member'>){if(ctx.member.role==='member')fail('Only group leaders can do that.');}
export function owner(ctx:Pick<MemberCtx,'member'>){if(ctx.member.role!=='owner')fail('Only the group owner can do that.');}
export function canRead(member:Doc<'memberships'>,r:Doc<'requests'>){return member.active&&member.groupId===r.groupId&&!r.deleted&&(r.visibility==='group'||member.role!=='member'||r.authorId===member.userId);}
export async function request(ctx:MemberCtx,id:Id<'requests'>){const row=await ctx.db.get(id);if(!row||!canRead(ctx.member,row))fail('Request unavailable.');return row;}
export function author(ctx:MemberCtx,r:Doc<'requests'>){if(r.authorId!==ctx.userId)fail('Only the author can change this request.');}
export async function displayName(ctx:QueryCtx,userId:Id<'users'>){return (await ctx.db.query('memberships').withIndex('by_userId',q=>q.eq('userId',userId)).unique())?.name??'Former member';}
export async function requestView(ctx:MemberCtx,r:Doc<'requests'>){
 const [name,prayed,following]=await Promise.all([displayName(ctx,r.authorId),ctx.db.query('prayers').withIndex('by_requestId_and_userId',q=>q.eq('requestId',r._id).eq('userId',ctx.userId)).unique(),ctx.db.query('follows').withIndex('by_requestId_and_userId',q=>q.eq('requestId',r._id).eq('userId',ctx.userId)).unique()]);
 const {_creationTime,groupId,deleted,...view}=r;
 return {...view,authorName:name,prayed:!!prayed,following:!!following,canEdit:r.authorId===ctx.userId};
}
export async function checkIn(ctx:MemberCtx,id?:Id<'checkIns'>){if(!id)return;const row=await ctx.db.get(id);if(!row||row.groupId!==ctx.group._id||!row.open||(row.closesAt!==undefined&&row.closesAt<=Date.now()))fail('This check-in has closed.');}
export async function notify(ctx:MutationCtx,user:Doc<'memberships'>,event:{kind:'update'|'reply'|'checkIn';requestId?:Id<'requests'>;checkInId?:Id<'checkIns'>}){if(user.active&&user.notifications)await ctx.db.insert('notifications',{...event,groupId:user.groupId,userId:user.userId,createdAt:Date.now(),unread:true});}

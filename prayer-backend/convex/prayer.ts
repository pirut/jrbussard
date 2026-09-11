import {v} from 'convex/values';
import {paginationOptsValidator} from 'convex/server';
import {getAuthUserId} from '@convex-dev/auth/server';
import {query,mutation,action,internalMutation} from './_generated/server';
import {internal} from './_generated/api';
import {status,visibility,category,entryKind} from './validators';
import {memberQuery,memberMutation,memberContext,fail,clean,leader,owner,request,author,canRead,displayName,requestView,checkIn,limiter} from './access';
import type {Id} from './_generated/dataModel';
import type {MemberCtx} from './access';
const pageArgs={paginationOpts:paginationOptsValidator};
const pageResult=v.object({page:v.array(v.any()),isDone:v.boolean(),continueCursor:v.string()});
const noResult=v.null();
const boundedPage=(opts:{numItems:number;cursor:string|null})=>({...opts,numItems:Math.min(Math.max(1,opts.numItems),50)});
export const viewer=query({args:{},returns:v.any(),handler:async(ctx)=>{
 const userId=await getAuthUserId(ctx);if(!userId)return null;const user=await ctx.db.get(userId);if(!user)return null;
 const member=await ctx.db.query('memberships').withIndex('by_userId',q=>q.eq('userId',userId)).unique();
 const group=member?.active?await ctx.db.get(member.groupId):null;
 const ownerEmail=process.env.TOGETHER_OWNER_EMAIL?.trim().toLowerCase();
 return {userId,email:user.email??'',name:member?.name??user.name??'',member:member?.active?{_id:member._id,role:member.role,notifications:member.notifications}:null,group:group?{_id:group._id,name:group.name,description:group.description,meetingSchedule:group.meetingSchedule}:null,canInitialize:!!ownerEmail&&!!user.emailVerificationTime&&user.email?.toLowerCase()===ownerEmail};
}});
export const initialize=mutation({args:{name:v.optional(v.string())},returns:v.id('groups'),handler:async(ctx,args)=>{
 const userId=await getAuthUserId(ctx);if(!userId)fail('Please sign in.');const user=await ctx.db.get(userId);
 if(!process.env.TOGETHER_OWNER_EMAIL||!user?.emailVerificationTime||user.email?.toLowerCase()!==process.env.TOGETHER_OWNER_EMAIL.trim().toLowerCase())fail('Only the configured, verified owner can initialize this group.');
 const existing=await ctx.db.query('groups').withIndex('by_key',q=>q.eq('key','together')).unique();if(existing)return existing._id;
 const groupId=await ctx.db.insert('groups',{key:'together',name:'Together',description:'A place to share, pray, and see God at work.',meetingSchedule:'',ownerId:userId});
 await ctx.db.insert('memberships',{groupId,userId,role:'owner',active:true,name:clean(args.name??'JR','Name',60),notifications:true});return groupId;
}});
export const board=memberQuery({args:{...pageArgs,status,filter:v.optional(v.union(v.literal('all'),v.literal('mine'),v.literal('following'))),search:v.optional(v.string()),presentation:v.optional(v.boolean())},returns:pageResult,handler:async(ctx,args)=>{
 const search=args.search?.trim().slice(0,120);const paginationOpts=boundedPage(args.paginationOpts);
 const rows=search?await ctx.db.query('requests').withSearchIndex('search_title',q=>q.search('title',search).eq('groupId',ctx.group._id).eq('status',args.status)).paginate(paginationOpts)
 :args.filter==='mine'?await ctx.db.query('requests').withIndex('by_groupId_and_authorId_and_status',q=>q.eq('groupId',ctx.group._id).eq('authorId',ctx.userId).eq('status',args.status)).order('desc').paginate(paginationOpts)
 :await ctx.db.query('requests').withIndex('by_groupId_and_status',q=>q.eq('groupId',ctx.group._id).eq('status',args.status)).order('desc').paginate(paginationOpts);
 const visible=rows.page.filter(r=>canRead(ctx.member,r)&&(!args.presentation||r.visibility==='group')&&(args.filter!=='mine'||r.authorId===ctx.userId));
 const views=await Promise.all(visible.map(r=>requestView(ctx,r)));
 return {page:views.filter(r=>args.filter!=='following'||r.following),isDone:rows.isDone,continueCursor:rows.continueCursor};
}});
export const detail=memberQuery({args:{requestId:v.id('requests')},returns:v.any(),handler:async(ctx,args)=>requestView(ctx,await request(ctx,args.requestId))});
export const timeline=memberQuery({args:{requestId:v.id('requests'),...pageArgs},returns:pageResult,handler:async(ctx,args)=>{
 await request(ctx,args.requestId);const rows=await ctx.db.query('entries').withIndex('by_requestId',q=>q.eq('requestId',args.requestId)).order('desc').paginate(boundedPage(args.paginationOpts));
 return {page:await Promise.all(rows.page.filter(e=>!e.deleted).map(async e=>({_id:e._id,kind:e.kind,body:e.body,authorId:e.authorId,authorName:await displayName(ctx,e.authorId),createdAt:e.createdAt,canDelete:e.authorId===ctx.userId||ctx.member.role!=='member'}))),isDone:rows.isDone,continueCursor:rows.continueCursor};
}});
export const createRequest=memberMutation({args:{title:v.string(),body:v.string(),category,visibility,checkInId:v.optional(v.id('checkIns'))},returns:v.id('requests'),handler:async(ctx,args)=>{
 await checkIn(ctx,args.checkInId);const now=Date.now();const id=await ctx.db.insert('requests',{...args,title:clean(args.title,'Title',140),body:clean(args.body,'Details',8000),groupId:ctx.group._id,authorId:ctx.userId,status:'ongoing',createdAt:now,updatedAt:now,prayerCount:0,latestUpdate:null,deleted:false});
 await ctx.db.insert('follows',{groupId:ctx.group._id,requestId:id,userId:ctx.userId});return id;
}});
export const editRequest=memberMutation({args:{requestId:v.id('requests'),title:v.string(),body:v.string(),category,visibility},returns:noResult,handler:async(ctx,args)=>{
 const r=await request(ctx,args.requestId);author(ctx,r);await ctx.db.patch(r._id,{title:clean(args.title,'Title',140),body:clean(args.body,'Details',8000),category:args.category,visibility:args.visibility,updatedAt:Date.now()});return null;
}});
async function addUpdate(ctx:MemberCtx&{db:any;scheduler:any},requestId:Id<'requests'>,kind:'update'|'reply',body:string,checkInId?:Id<'checkIns'>){
 const now=Date.now();const id=await ctx.db.insert('entries',{groupId:ctx.group._id,requestId,authorId:ctx.userId,kind,body:clean(body,kind==='update'?'Update':'Reply',5000),createdAt:now,deleted:false,...(checkInId?{checkInId}:{})});
 await ctx.db.patch(requestId,{updatedAt:now,...(kind==='update'?{latestUpdate:{body:body.trim(),createdAt:now}}:{})});
 await ctx.scheduler.runAfter(0,internal.delivery.entry,{requestId,actorId:ctx.userId,kind,cursor:null});return id;
}
export const setStatus=memberMutation({args:{requestId:v.id('requests'),status,body:v.optional(v.string())},returns:noResult,handler:async(ctx,args)=>{
 const r=await request(ctx,args.requestId);author(ctx,r);if(args.body?.trim())await addUpdate(ctx,r._id,'update',args.body);await ctx.db.patch(r._id,{status:args.status,updatedAt:Date.now()});return null;
}});
export const deleteRequest=memberMutation({args:{requestId:v.id('requests')},returns:noResult,handler:async(ctx,args)=>{
 const r=await request(ctx,args.requestId);if(r.authorId!==ctx.userId)leader(ctx);
 await ctx.db.patch(r._id,{deleted:true,title:'Deleted request',body:'',latestUpdate:null,updatedAt:Date.now()});await ctx.scheduler.runAfter(0,internal.delivery.cleanup,{requestId:r._id});return null;
}});
export const addEntry=memberMutation({args:{requestId:v.id('requests'),kind:entryKind,body:v.string(),checkInId:v.optional(v.id('checkIns'))},returns:v.id('entries'),handler:async(ctx,args)=>{
 const r=await request(ctx,args.requestId);if(args.kind==='update')author(ctx,r);await checkIn(ctx,args.checkInId);return addUpdate(ctx,r._id,args.kind,args.body,args.checkInId);
}});
export const deleteEntry=memberMutation({args:{entryId:v.id('entries')},returns:noResult,handler:async(ctx,args)=>{
 const e=await ctx.db.get(args.entryId);if(!e||e.deleted)fail('Entry unavailable.');await request(ctx,e.requestId);if(e.authorId!==ctx.userId)leader(ctx);await ctx.db.patch(e._id,{deleted:true,body:''});
 if(e.kind==='update'){const recent=await ctx.db.query('entries').withIndex('by_requestId_and_kind',q=>q.eq('requestId',e.requestId).eq('kind','update')).order('desc').take(100);const last=recent.find(x=>!x.deleted);await ctx.db.patch(e.requestId,{latestUpdate:last?{body:last.body,createdAt:last.createdAt}:null});}return null;
}});
export const setPrayed=memberMutation({args:{requestId:v.id('requests'),value:v.boolean()},returns:noResult,handler:async(ctx,args)=>{
 const r=await request(ctx,args.requestId);const old=await ctx.db.query('prayers').withIndex('by_requestId_and_userId',q=>q.eq('requestId',r._id).eq('userId',ctx.userId)).unique();
 if(args.value&&!old){await ctx.db.insert('prayers',{requestId:r._id,userId:ctx.userId});await ctx.db.patch(r._id,{prayerCount:r.prayerCount+1});}else if(!args.value&&old){await ctx.db.delete(old._id);await ctx.db.patch(r._id,{prayerCount:Math.max(0,r.prayerCount-1)});}return null;
}});
export const setFollow=memberMutation({args:{requestId:v.id('requests'),value:v.boolean()},returns:noResult,handler:async(ctx,args)=>{
 const r=await request(ctx,args.requestId);const old=await ctx.db.query('follows').withIndex('by_requestId_and_userId',q=>q.eq('requestId',r._id).eq('userId',ctx.userId)).unique();if(args.value&&!old)await ctx.db.insert('follows',{groupId:ctx.group._id,requestId:r._id,userId:ctx.userId});else if(!args.value&&old)await ctx.db.delete(old._id);return null;
}});
export const checkIns=memberQuery({args:{},returns:v.array(v.any()),handler:async(ctx)=>{
 const rows=await ctx.db.query('checkIns').withIndex('by_groupId_and_open',q=>q.eq('groupId',ctx.group._id)).order('desc').take(100);return rows.map(({_id,prompt,createdAt,closesAt,open})=>({_id,prompt,createdAt,...(closesAt!==undefined?{closesAt}:{}),open:open&&(closesAt===undefined||closesAt>Date.now())}));
}});
export const createCheckIn=memberMutation({args:{prompt:v.string(),closesAt:v.optional(v.number())},returns:v.id('checkIns'),handler:async(ctx,args)=>{
 leader(ctx);if(args.closesAt!==undefined&&(!Number.isFinite(args.closesAt)||args.closesAt<=Date.now()))fail('Closing date must be in the future.');const id=await ctx.db.insert('checkIns',{groupId:ctx.group._id,authorId:ctx.userId,prompt:clean(args.prompt,'Prompt',600),createdAt:Date.now(),open:true,...(args.closesAt!==undefined?{closesAt:args.closesAt}:{})});await ctx.scheduler.runAfter(0,internal.delivery.checkIn,{checkInId:id,actorId:ctx.userId,cursor:null});return id;
}});
export const closeCheckIn=memberMutation({args:{checkInId:v.id('checkIns')},returns:noResult,handler:async(ctx,args)=>{
 leader(ctx);const row=await ctx.db.get(args.checkInId);if(!row||row.groupId!==ctx.group._id)fail('Check-in unavailable.');await ctx.db.patch(row._id,{open:false});return null;
}});
async function permittedNotification(ctx:MemberCtx,n:{groupId:Id<'groups'>;requestId?:Id<'requests'>;checkInId?:Id<'checkIns'>}){
 if(n.groupId!==ctx.group._id)return false;if(n.requestId){const r=await ctx.db.get(n.requestId);return !!r&&canRead(ctx.member,r);}if(n.checkInId){const c=await ctx.db.get(n.checkInId);return !!c&&c.groupId===ctx.group._id;}return false;
}
export const notifications=memberQuery({args:pageArgs,returns:pageResult,handler:async(ctx,args)=>{
 const rows=await ctx.db.query('notifications').withIndex('by_userId',q=>q.eq('userId',ctx.userId)).order('desc').paginate(boundedPage(args.paginationOpts));const page=[];
 for(const n of rows.page)if(await permittedNotification(ctx,n)){const {_creationTime,groupId,userId,unread,...rest}=n;page.push({...rest,title:n.kind==='checkIn'?'How can we pray for you?':n.kind==='update'?'An update on a request you follow':'New encouragement on a request you follow'});}return {page,isDone:rows.isDone,continueCursor:rows.continueCursor};
}});
export const unreadCount=memberQuery({args:{},returns:v.number(),handler:async(ctx)=>{
 const rows=await ctx.db.query('notifications').withIndex('by_userId_and_unread',q=>q.eq('userId',ctx.userId).eq('unread',true)).order('desc').take(100);let count=0;for(const n of rows)if(await permittedNotification(ctx,n))count++;return count;
}});
export const markRead=memberMutation({args:{notificationId:v.id('notifications')},returns:noResult,handler:async(ctx,args)=>{
 const n=await ctx.db.get(args.notificationId);if(!n||n.userId!==ctx.userId||n.groupId!==ctx.group._id)fail('Notification unavailable.');await ctx.db.patch(n._id,{unread:false,readAt:Date.now()});return null;
}});
export const members=memberQuery({args:{},returns:v.array(v.any()),handler:async(ctx)=>{leader(ctx);const rows=await ctx.db.query('memberships').withIndex('by_groupId_and_active',q=>q.eq('groupId',ctx.group._id)).take(200);return rows.map(({_id,userId,name,role,active})=>({_id,userId,name,role,active}));}});
export const invites=memberQuery({args:{},returns:v.array(v.any()),handler:async(ctx)=>{leader(ctx);const rows=await ctx.db.query('invitations').withIndex('by_groupId',q=>q.eq('groupId',ctx.group._id)).order('desc').take(100);return rows.map(({_id,createdAt,expiresAt,maxUses,uses,revoked})=>({_id,createdAt,expiresAt,maxUses,uses,revoked}));}});
async function digest(token:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');}
export const createInvite=action({args:{expiresInDays:v.optional(v.number()),maxUses:v.optional(v.number())},returns:v.object({token:v.string(),inviteId:v.id('invitations')}),handler:async(ctx,args)=>{
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');const inviteId:Id<'invitations'>=await ctx.runMutation(internal.prayer.storeInvite,{...args,tokenHash:await digest(token)});return {token,inviteId};
}});
export const storeInvite=internalMutation({args:{tokenHash:v.string(),expiresInDays:v.optional(v.number()),maxUses:v.optional(v.number())},returns:v.id('invitations'),handler:async(ctx,args)=>{
 const m=await memberContext(ctx);leader(m);await limiter.limit(ctx,'invite',{key:m.userId,throws:true});const days=args.expiresInDays??7;const uses=args.maxUses??25;if(!Number.isInteger(days)||days<1||days>30||!Number.isInteger(uses)||uses<1||uses>100)fail('Invitations support 1–30 days and 1–100 uses.');
 return ctx.db.insert('invitations',{groupId:m.group._id,tokenHash:args.tokenHash,createdBy:m.userId,createdAt:Date.now(),expiresAt:Date.now()+days*86400000,maxUses:uses,uses:0,revoked:false});
}});
export const redeemInvite=action({args:{token:v.string(),name:v.string()},returns:v.id('groups'),handler:async(ctx,args):Promise<Id<'groups'>>=>{
 if(!/^[a-f0-9]{64}$/.test(args.token))fail('This invitation is invalid.');return ctx.runMutation(internal.prayer.redeem,{tokenHash:await digest(args.token),name:args.name});
}});
export const redeem=internalMutation({args:{tokenHash:v.string(),name:v.string()},returns:v.id('groups'),handler:async(ctx,args)=>{
 const userId=await getAuthUserId(ctx);if(!userId)fail('Please sign in.');const user=await ctx.db.get(userId);if(!user?.emailVerificationTime)fail('Please verify your email.');await limiter.limit(ctx,'invite',{key:userId,throws:true});
 const invite=await ctx.db.query('invitations').withIndex('by_tokenHash',q=>q.eq('tokenHash',args.tokenHash)).unique();if(!invite||invite.revoked||invite.expiresAt<=Date.now()||invite.uses>=invite.maxUses)fail('This invitation is expired, revoked, or already used.');
 const existing=await ctx.db.query('memberships').withIndex('by_userId',q=>q.eq('userId',userId)).unique();if(existing){if(!existing.active)fail('Please ask the group owner to restore your membership.');if(existing.groupId!==invite.groupId)fail('You already belong to another group.');return existing.groupId;}
 const count=await ctx.db.query('memberships').withIndex('by_groupId_and_active',q=>q.eq('groupId',invite.groupId).eq('active',true)).take(101);if(count.length>=100)fail('This group has reached its member limit.');
 await ctx.db.insert('memberships',{groupId:invite.groupId,userId,name:clean(args.name,'Name',60),role:'member',active:true,notifications:true});await ctx.db.patch(invite._id,{uses:invite.uses+1});return invite.groupId;
}});
export const revokeInvite=memberMutation({args:{inviteId:v.id('invitations')},returns:noResult,handler:async(ctx,args)=>{leader(ctx);const row=await ctx.db.get(args.inviteId);if(!row||row.groupId!==ctx.group._id)fail('Invitation unavailable.');await ctx.db.patch(row._id,{revoked:true});return null;}});
export const setRole=memberMutation({args:{memberId:v.id('memberships'),role:v.union(v.literal('leader'),v.literal('member'))},returns:noResult,handler:async(ctx,args)=>{owner(ctx);const row=await ctx.db.get(args.memberId);if(!row||!row.active||row.groupId!==ctx.group._id||row.role==='owner')fail('Member unavailable.');await ctx.db.patch(row._id,{role:args.role});return null;}});
export const removeMember=memberMutation({args:{memberId:v.id('memberships')},returns:noResult,handler:async(ctx,args)=>{owner(ctx);const row=await ctx.db.get(args.memberId);if(!row||row.groupId!==ctx.group._id||row.role==='owner')fail('Member unavailable.');await ctx.db.patch(row._id,{active:false});return null;}});
export const updateProfile=memberMutation({args:{name:v.string(),notifications:v.boolean()},returns:noResult,handler:async(ctx,args)=>{await ctx.db.patch(ctx.member._id,{name:clean(args.name,'Name',60),notifications:args.notifications});return null;}});
export const updateGroup=memberMutation({args:{name:v.string(),description:v.string(),meetingSchedule:v.string()},returns:noResult,handler:async(ctx,args)=>{owner(ctx);await ctx.db.patch(ctx.group._id,{name:clean(args.name,'Group name',80),description:clean(args.description,'Description',500,0),meetingSchedule:clean(args.meetingSchedule,'Meeting schedule',200,0)});return null;}});

export const restoreMember=memberMutation({args:{memberId:v.id('memberships')},returns:noResult,handler:async(ctx,args)=>{owner(ctx);const row=await ctx.db.get(args.memberId);if(!row||row.groupId!==ctx.group._id||row.role==='owner')fail('Member unavailable.');const active=await ctx.db.query('memberships').withIndex('by_groupId_and_active',q=>q.eq('groupId',ctx.group._id).eq('active',true)).take(100);if(!row.active&&active.length>=100)fail('This group has reached its member limit.');await ctx.db.patch(row._id,{active:true,role:'member'});return null;}});
export const updates=memberQuery({args:pageArgs,returns:pageResult,handler:async(ctx,args)=>{
 const rows=await ctx.db.query('entries').withIndex('by_groupId_and_kind',q=>q.eq('groupId',ctx.group._id).eq('kind','update')).order('desc').paginate(boundedPage(args.paginationOpts));const page=[];
 for(const e of rows.page){if(e.deleted)continue;const r=await ctx.db.get(e.requestId);if(r&&canRead(ctx.member,r))page.push({_id:e._id,requestId:r._id,title:r.title,requestTitle:r.title,body:e.body,authorId:e.authorId,authorName:await displayName(ctx,e.authorId),createdAt:e.createdAt});}
 return {page,isDone:rows.isDone,continueCursor:rows.continueCursor};
}});

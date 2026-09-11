import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import rateLimiter from '@convex-dev/rate-limiter/test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.ts');
const make=()=>{const t=convexTest({schema,modules});rateLimiter.register(t);return t;};
async function setup(){
 const t=make();const ids=await t.run(async ctx=>{
  const a=await ctx.db.insert('users',{email:'owner@example.com',emailVerificationTime:Date.now()});const b=await ctx.db.insert('users',{email:'b@example.com',emailVerificationTime:Date.now()});const c=await ctx.db.insert('users',{email:'c@example.com',emailVerificationTime:Date.now()});const d=await ctx.db.insert('users',{email:'d@example.com',emailVerificationTime:Date.now()});
  const group=await ctx.db.insert('groups',{key:'together',name:'Together',description:'',meetingSchedule:'',ownerId:a});
  const other=await ctx.db.insert('groups',{key:'other',name:'Other',description:'',meetingSchedule:'',ownerId:d});
  const owner=await ctx.db.insert('memberships',{groupId:group,userId:a,name:'Owner',role:'owner',active:true,notifications:true});const member=await ctx.db.insert('memberships',{groupId:group,userId:b,name:'Member',role:'member',active:true,notifications:true});const lead=await ctx.db.insert('memberships',{groupId:group,userId:c,name:'Leader',role:'leader',active:true,notifications:true});await ctx.db.insert('memberships',{groupId:other,userId:d,name:'Other',role:'owner',active:true,notifications:true});
  return {a,b,c,d,owner,member,lead,group,other};
 });
 return {t,ids,owner:t.withIdentity({subject:ids.a+'|owner-session'}),member:t.withIdentity({subject:ids.b+'|member-session'}),leader:t.withIdentity({subject:ids.c+'|leader-session'}),outsider:t.withIdentity({subject:ids.d+'|other-session'})};
}
const req={title:'Pray for my family',body:'Private details',category:'family',visibility:'group'};
const page={paginationOpts:{cursor:null,numItems:20},status:'ongoing'};
describe('Together authorization and consistency',()=>{
 beforeEach(()=>vi.useFakeTimers());afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
 it('rejects anonymous access and prevents cross-group request reads and changes',async()=>{
  const {t,owner,outsider}=await setup();const id=await owner.mutation(api.prayer.createRequest,req);
  await expect(t.query(api.prayer.board,page)).rejects.toThrow('sign in');await expect(outsider.query(api.prayer.detail,{requestId:id})).rejects.toThrow('unavailable');await expect(outsider.mutation(api.prayer.setPrayed,{requestId:id,value:true})).rejects.toThrow('unavailable');
 });
 it('enforces leaders-only on board, detail, timeline, updates, search, notifications and presentation',async()=>{
  const {t,ids,owner,member,leader}=await setup();const id=await owner.mutation(api.prayer.createRequest,{...req,visibility:'leaders'});
  await owner.mutation(api.prayer.addEntry,{requestId:id,kind:'update',body:'Sensitive news'});
  const note=await t.run(ctx=>ctx.db.insert('notifications',{groupId:ids.group,userId:ids.b,kind:'update',requestId:id,createdAt:Date.now(),unread:true}));
  expect((await member.query(api.prayer.board,page)).page).toHaveLength(0);expect((await member.query(api.prayer.board,{...page,search:'family'})).page).toHaveLength(0);
  await expect(member.query(api.prayer.detail,{requestId:id})).rejects.toThrow('unavailable');await expect(member.query(api.prayer.timeline,{requestId:id,paginationOpts:page.paginationOpts})).rejects.toThrow('unavailable');
  expect((await member.query(api.prayer.updates,{paginationOpts:page.paginationOpts})).page).toHaveLength(0);expect((await member.query(api.prayer.notifications,{paginationOpts:page.paginationOpts})).page).toHaveLength(0);expect(await member.query(api.prayer.unreadCount,{})).toBe(0);
  expect((await leader.query(api.prayer.board,page)).page).toHaveLength(1);expect((await leader.query(api.prayer.board,{...page,presentation:true})).page).toHaveLength(0);
  expect(note).toBeTruthy();
 });
 it('allows author private access but rejects unauthorized edits and role escalation',async()=>{
  const {owner,member,leader,ids}=await setup();const id=await member.mutation(api.prayer.createRequest,{...req,visibility:'leaders'});
  expect((await member.query(api.prayer.detail,{requestId:id})).canEdit).toBe(true);expect((await leader.query(api.prayer.detail,{requestId:id})).canEdit).toBe(false);
  await expect(leader.mutation(api.prayer.setStatus,{requestId:id,status:'answered'})).rejects.toThrow('author');await expect(owner.mutation(api.prayer.addEntry,{requestId:id,kind:'update',body:'Not mine'})).rejects.toThrow('author');await expect(member.mutation(api.prayer.setRole,{memberId:ids.member,role:'leader'})).rejects.toThrow('owner');
 });
 it('removes access immediately and restores only with explicit owner action',async()=>{
  const {owner,member,ids}=await setup();await owner.mutation(api.prayer.removeMember,{memberId:ids.member});await expect(member.query(api.prayer.board,page)).rejects.toThrow('invitation');expect((await member.query(api.prayer.viewer,{})).member).toBeNull();await owner.mutation(api.prayer.restoreMember,{memberId:ids.member});expect((await member.query(api.prayer.viewer,{})).member.role).toBe('member');
 });
 it('prayer and follow desired-state writes are idempotent and deleted content is inaccessible',async()=>{
  const {owner,member}=await setup();const id=await owner.mutation(api.prayer.createRequest,req);
  await member.mutation(api.prayer.setPrayed,{requestId:id,value:true});await member.mutation(api.prayer.setPrayed,{requestId:id,value:true});await member.mutation(api.prayer.setFollow,{requestId:id,value:true});await member.mutation(api.prayer.setFollow,{requestId:id,value:true});let r=await member.query(api.prayer.detail,{requestId:id});expect(r.prayerCount).toBe(1);expect(r.following).toBe(true);
  await member.mutation(api.prayer.setPrayed,{requestId:id,value:false});await member.mutation(api.prayer.setPrayed,{requestId:id,value:false});r=await member.query(api.prayer.detail,{requestId:id});expect(r.prayerCount).toBe(0);await owner.mutation(api.prayer.deleteRequest,{requestId:id});await expect(member.query(api.prayer.detail,{requestId:id})).rejects.toThrow('unavailable');
 });
 it('requires verified configured owner, never the first sign-in',async()=>{
  const t=make();vi.stubEnv('TOGETHER_OWNER_EMAIL','owner@example.com');const ids=await t.run(async ctx=>({first:await ctx.db.insert('users',{email:'random@example.com',emailVerificationTime:Date.now()}),unverified:await ctx.db.insert('users',{email:'owner@example.com'}),owner:await ctx.db.insert('users',{email:'owner@example.com',emailVerificationTime:Date.now()})}));
  await expect(t.withIdentity({subject:ids.first+'|x'}).mutation(api.prayer.initialize,{})).rejects.toThrow('verified owner');await expect(t.withIdentity({subject:ids.unverified+'|x'}).mutation(api.prayer.initialize,{})).rejects.toThrow('verified owner');expect(await t.withIdentity({subject:ids.owner+'|x'}).mutation(api.prayer.initialize,{name:'JR'})).toBeTruthy();
 });
 it('rejects expired/revoked/exhausted invites and consumes successful invitation once',async()=>{
  const {t,ids}=await setup();const u=await t.run(ctx=>ctx.db.insert('users',{email:'new@example.com',emailVerificationTime:Date.now()}));const newcomer=t.withIdentity({subject:u+'|x'});
  const seed=async(tokenHash:string,extras={})=>t.run(ctx=>ctx.db.insert('invitations',{groupId:ids.group,tokenHash,createdBy:ids.a,createdAt:Date.now(),expiresAt:Date.now()+10000,maxUses:1,uses:0,revoked:false,...extras}));
  await seed('expired',{expiresAt:Date.now()-1});await seed('revoked',{revoked:true});await seed('used',{uses:1});for(const tokenHash of ['expired','revoked','used'])await expect(newcomer.mutation(internal.prayer.redeem,{tokenHash,name:'New'})).rejects.toThrow('expired');
  const invite=await seed('good');await newcomer.mutation(internal.prayer.redeem,{tokenHash:'good',name:'New'});expect((await newcomer.query(api.prayer.viewer,{})).member.role).toBe('member');expect((await t.run(ctx=>ctx.db.get(invite)))?.uses).toBe(1);
 });
 it('closed check-ins stay in history but reject linked responses; member cannot create prompts',async()=>{
  const {owner,member}=await setup();await expect(member.mutation(api.prayer.createCheckIn,{prompt:'This week'})).rejects.toThrow('leaders');const id=await owner.mutation(api.prayer.createCheckIn,{prompt:'This week'});await owner.mutation(api.prayer.closeCheckIn,{checkInId:id});expect((await member.query(api.prayer.checkIns,{}))[0].open).toBe(false);await expect(member.mutation(api.prayer.createRequest,{...req,checkInId:id})).rejects.toThrow('closed');
 });
});

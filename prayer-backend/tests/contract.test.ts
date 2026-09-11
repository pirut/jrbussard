import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
// anyApi intentionally decouples this app from the game's codegen. Keep its public names checked.
describe('frontend/backend endpoint contract',()=>{
 it('every frontend prayerApi endpoint exists and actions use useAction',()=>{
  const root=resolve(process.cwd(),'../src/prayer');const backend=readFileSync(resolve(process.cwd(),'convex/prayer.ts'),'utf8');
  const exports=new Set([...backend.matchAll(/export const (\w+)\s*=/g)].map(m=>m[1]));
  const actions=new Set([...backend.matchAll(/export const (\w+)\s*=\s*action\(/g)].map(m=>m[1]));
  const refs:string[]=[];
  for(const file of readdirSync(root).filter(f=>f.endsWith('.js'))){const source=readFileSync(resolve(root,file),'utf8');for(const m of source.matchAll(/prayerApi\.(\w+)/g)){refs.push(m[1]);expect(exports.has(m[1]),`${file} references missing api.prayer.${m[1]}`).toBe(true);}for(const m of source.matchAll(/useMutation\(prayerApi\.(\w+)/g))expect(actions.has(m[1]),`${file} must use useAction for ${m[1]}`).toBe(false);}
  expect(refs.length).toBeGreaterThan(10);
 });
});

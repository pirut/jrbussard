// Create an NFC tag URL (shown once; only its hash is stored).
//   npm --prefix nest-backend run tag -- --label "Nest stone" [--base https://jrbussard.com] [--prod]
// Write the printed URL to the tag with the free "NFC Tools" iOS app (Write → Add a record → URL).
import { parseArgs, runInternal } from './run-internal.mjs';

const a = parseArgs(process.argv.slice(2));
const base = typeof a.base === 'string' ? a.base : a.prod ? 'https://jrbussard.com' : 'http://localhost:3000';
const label = typeof a.label === 'string' ? a.label : 'Nest';
const r = runInternal('claims:mintTag', { label, base }, { prod: !!a.prod });
console.log(`\nTag ${r.tagId} ("${label}"). Write this URL to the tag (it is the tag's key; keep it private):\n\n  ${r.url}\n`);

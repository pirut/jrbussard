// Mint a single-use, 15-minute claim link.
//   npm --prefix nest-backend run claim -- [--base https://jrbussard.com] [--prod] [--device]
// Owner purpose by default (first passkey); --device adds another device later.
import { parseArgs, runInternal } from './run-internal.mjs';

const a = parseArgs(process.argv.slice(2));
const purpose = a.device ? 'device' : 'owner';
const base = typeof a.base === 'string' ? a.base : a.prod ? 'https://jrbussard.com' : 'http://localhost:3000';
const r = runInternal('claims:mintClaim', { purpose, base }, { prod: !!a.prod });
console.log(`\n${purpose === 'owner' ? 'Owner' : 'Device'} claim link (single use, expires ${new Date(r.expiresAt).toLocaleTimeString()}):\n\n  ${r.url}\n\nOpen it on the iPhone in Safari and follow the Face ID prompt. Do not share it.\n`);

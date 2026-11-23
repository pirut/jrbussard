/* Function references for the nest-creature backend.

   The backend's generated `api` lives in nest-backend/convex/_generated,
   outside src/. Create React App refuses imports from outside src/
   (ModuleScopePlugin), so we use `anyApi`, which builds the same
   "module:function" references from property names at runtime. The names
   below are exactly those in docs/nest-api.md. */

import { anyApi } from 'convex/server';

export const api = anyApi;

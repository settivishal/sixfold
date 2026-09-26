// Copies the shared cube logic into the Edge Function (Deno can't import outside its folder when deployed).
// `npm test` fails if the copies drift, so run this after changing anything in src/shared/.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

const from = new URL('../src/shared/', import.meta.url), to = new URL('../supabase/functions/api/_shared/', import.meta.url);
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from)) if (f.endsWith('.js')) copyFileSync(new URL(f, from), new URL(f, to));
console.log('shared modules synced');

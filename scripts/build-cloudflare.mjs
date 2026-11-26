import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Publish only the approved storefront files; never publish source config or admin data.
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const publicPaths = ['index.html', 'shop.js', 'assets', 'cart', 'home-terrain', 'woven-stride'];
for (const path of publicPaths) statSync(join(root, path));
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const path of publicPaths) cpSync(join(root, path), join(dist, path), { recursive: true });
console.log('NORX static site prepared in dist/');

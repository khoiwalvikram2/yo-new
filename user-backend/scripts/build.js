#!/usr/bin/env node
/**
 * Build: TypeScript -> dist, resolve path aliases, normalise ESM imports, copy assets.
 *
 * Dependency resolution is handled by the npm workspace at the repository root:
 * shared sources and application sources resolve the same physical copy of
 * drizzle-orm, zod, pg and friends. No node_modules linking is required here.
 */
import { rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const DIST_DIR = join(ROOT_DIR, 'dist');

const run = (cmd) => execSync(cmd, { stdio: 'inherit', cwd: ROOT_DIR });

async function build() {
  try {
    console.log('Cleaning dist directory...');
    if (existsSync(DIST_DIR)) {
      await rm(DIST_DIR, { recursive: true, force: true });
    }

    console.log('Compiling TypeScript...');
    run('tsc -p tsconfig.json');

    console.log('Resolving path aliases...');
    run('tsc-alias');

    console.log('Fixing ESM imports...');
    run('node scripts/fix-esm-imports.js');

    console.log('Copying assets...');
    run('node scripts/copy-assets.js');

    console.log('Build completed successfully!');
  } catch (error) {
    if (error?.message) process.stderr.write(`Build failed: ${error.message}\n`);
    process.exit(1);
  }
}

build();

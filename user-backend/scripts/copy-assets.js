#!/usr/bin/env node
/**
 * Post-build script to copy non-TS assets (.graphql files) to dist folder
 */
import { readdir, copyFile, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Copy from user-backend/src to dist/user-backend/src
const USER_SRC_DIR = join(__dirname, '..', 'src');
const USER_DIST_DIR = join(__dirname, '..', 'dist', 'user-backend', 'src');

// Copy from shared/src to dist/shared/src
const SHARED_SRC_DIR = join(__dirname, '..', '..', 'shared', 'src');
const SHARED_DIST_DIR = join(__dirname, '..', 'dist', 'shared', 'src');

const EXTENSIONS_TO_COPY = ['.graphql', '.gql'];

async function copyAssets(srcDir, distDir) {
  try {
    const entries = await readdir(srcDir);
    
    for (const entry of entries) {
      const srcPath = join(srcDir, entry);
      const distPath = join(distDir, entry);
      const stats = await stat(srcPath);
      
      if (stats.isDirectory()) {
        await copyAssets(srcPath, distPath);
      } else {
        const shouldCopy = EXTENSIONS_TO_COPY.some(ext => entry.endsWith(ext));
        if (shouldCopy) {
          try {
            await mkdir(dirname(distPath), { recursive: true });
            await copyFile(srcPath, distPath);
            console.log(`Copied: ${entry}`);
          } catch (err) {
            console.error(`Error copying ${srcPath}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

console.log('Copying assets to dist...');
console.log('Copying user-backend assets...');
await copyAssets(USER_SRC_DIR, USER_DIST_DIR);
console.log('Copying shared assets...');
await copyAssets(SHARED_SRC_DIR, SHARED_DIST_DIR);
console.log('Done copying assets!');

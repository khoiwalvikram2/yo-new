#!/usr/bin/env node
/**
 * Post-build script to copy non-TS assets (.graphql files) to dist folder
 */
import { readdir, copyFile, mkdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src');
const DIST_DIR = join(__dirname, '..', 'dist', 'admin-backend', 'src');

const EXTENSIONS_TO_COPY = ['.graphql', '.gql', '.json'];

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
    // Directory doesn't exist, skip
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

console.log('Copying assets to dist...');
await copyAssets(SRC_DIR, DIST_DIR);
console.log('Done copying assets!');

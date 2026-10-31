#!/usr/bin/env node
/**
 * Post-build script to add .js extensions to relative imports for ESM compatibility
 */
import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');

async function processFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  
  // Add .js extension to relative imports that don't already have it
  // Matches: from './path' or from '../path' or from '../../path' etc.
  const fixed = content.replace(
    /from\s+['"](\.[^'"]+)['"]/g,
    (match, importPath) => {
      // Skip if already has extension
      if (importPath.endsWith('.js') || importPath.endsWith('.json')) {
        return match;
      }
      // Skip node_modules imports
      if (importPath.includes('node_modules')) {
        return match;
      }
      return `from '${importPath}.js'`;
    }
  );
  
  // Also fix dynamic imports
  const fixedDynamic = fixed.replace(
    /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    (match, importPath) => {
      if (importPath.endsWith('.js') || importPath.endsWith('.json')) {
        return match;
      }
      if (importPath.includes('node_modules')) {
        return match;
      }
      return `import('${importPath}.js')`;
    }
  );
  
  if (fixedDynamic !== content) {
    await writeFile(filePath, fixedDynamic, 'utf-8');
  }
}

async function processDir(dirPath) {
  const entries = await readdir(dirPath);
  
  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const stats = await stat(fullPath);
    
    if (stats.isDirectory()) {
      await processDir(fullPath);
    } else if (entry.endsWith('.js')) {
      await processFile(fullPath);
    }
  }
}

console.log('Fixing ESM imports...');
await processDir(DIST_DIR);
console.log('Done!');

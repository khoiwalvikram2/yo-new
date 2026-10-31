import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const vipTypeDefs = readFileSync(join(__dirname, 'vip.graphql'), 'utf-8');


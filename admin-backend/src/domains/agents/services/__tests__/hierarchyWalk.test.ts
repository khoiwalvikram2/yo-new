/**
 * CR-12: cycle-safe hierarchy traversal (walkUnique).
 * Run with: node --import tsx --test src/domains/agents/services/__tests__/hierarchyWalk.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { walkUnique } from '../hierarchyWalk.js';

/** Build an async getChildren from a plain adjacency map. */
function fromAdjacency(map: Record<string, string[]>): (id: string) => Promise<string[]> {
	return async (id: string) => map[id] ?? [];
}

describe('walkUnique (cycle-safe hierarchy traversal)', () => {
	it('returns root for a leaf with no children', async () => {
		const result = await walkUnique('A', fromAdjacency({}));
		assert.deepStrictEqual(result, ['A']);
	});

	it('returns every node exactly once for a normal tree', async () => {
		// A -> B, C ; B -> D
		const result = await walkUnique('A', fromAdjacency({ A: ['B', 'C'], B: ['D'] }));
		assert.deepStrictEqual([...result].sort(), ['A', 'B', 'C', 'D']);
		assert.strictEqual(new Set(result).size, result.length, 'no duplicates');
		assert.strictEqual(result[0], 'A', 'root first');
	});

	it('TERMINATES and de-dups on a direct cycle A -> B -> A', async () => {
		const result = await walkUnique('A', fromAdjacency({ A: ['B'], B: ['A'] }));
		// Must terminate (this line is only reached if it did) and return each node once.
		assert.deepStrictEqual([...result].sort(), ['A', 'B']);
		assert.strictEqual(new Set(result).size, result.length, 'no duplicates');
	});

	it('TERMINATES on a self-loop A -> A', async () => {
		const result = await walkUnique('A', fromAdjacency({ A: ['A'] }));
		assert.deepStrictEqual(result, ['A']);
	});

	it('TERMINATES on a longer cycle A -> B -> C -> A with a side branch', async () => {
		// Cycle A->B->C->A plus C->D (D is a leaf reachable from the cycle).
		const result = await walkUnique('A', fromAdjacency({ A: ['B'], B: ['C'], C: ['A', 'D'] }));
		assert.deepStrictEqual([...result].sort(), ['A', 'B', 'C', 'D']);
		assert.strictEqual(new Set(result).size, result.length, 'no duplicates');
	});

	it('de-dups a diamond (A->B, A->C, B->D, C->D)', async () => {
		const result = await walkUnique('A', fromAdjacency({ A: ['B', 'C'], B: ['D'], C: ['D'] }));
		assert.deepStrictEqual([...result].sort(), ['A', 'B', 'C', 'D']);
		assert.strictEqual(new Set(result).size, result.length, 'D visited once despite two parents');
	});
});

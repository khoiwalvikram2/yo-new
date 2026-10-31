/**
 * Cycle-safe hierarchy traversal helper (CR-12, defense in depth).
 *
 * The agents hierarchy is supposed to be a tree, but a corrupt/re-parented state
 * (e.g. A -> B and B -> A) would make a naive recursive descent (no visited set)
 * recurse forever and stack-overflow. `walkUnique` performs a depth-first descent
 * from `rootId`, returning every reachable id (including the root) exactly once,
 * and is guaranteed to terminate even when `getChildren` describes a cyclic graph.
 *
 * The traversal is async-aware (children are fetched via an async callback) but the
 * cycle-safety logic itself is pure and easy to unit-test with a synthetic adjacency
 * map (see __tests__/hierarchyWalk.test.ts).
 *
 * @param rootId      the id to start from (always included in the result)
 * @param getChildren async function returning the direct child ids of a given id
 * @param visited     internal accumulator of already-seen ids; callers normally omit it
 * @returns ordered list of unique ids reachable from `rootId` (root first)
 */
export async function walkUnique(
	rootId: string,
	getChildren: (id: string) => Promise<string[]>,
	visited: Set<string> = new Set<string>(),
): Promise<string[]> {
	// If we've already seen this node, it's part of a cycle (or a diamond) — stop.
	if (visited.has(rootId)) {
		return [];
	}
	visited.add(rootId);

	const result: string[] = [rootId];
	const childIds = await getChildren(rootId);
	for (const childId of childIds) {
		if (visited.has(childId)) {
			continue;
		}
		const descendants = await walkUnique(childId, getChildren, visited);
		result.push(...descendants);
	}
	return result;
}

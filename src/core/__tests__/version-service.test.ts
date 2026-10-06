import { describe, expect, it } from 'vitest';
import { compareVersions, createPlanVersion } from '../version-service';
import { createWorkingResults } from '../plan-service';
import { PACKING_RULES_VERSION, type PackingItem, type PackingSnapshot, type WorkingResults } from '../models';

const item = (id: string, name = id): PackingItem => ({ id, name, category: '其他', length: 2, width: 2, height: 2, weight: 1, priority: 2, mustHave: false });

function snapshot(items: PackingItem[]): PackingSnapshot {
  return { suitcase: { length: 10, width: 10, height: 10, maxWeight: 10 }, selectedPlan: 'comfort', items };
}

function version(versionId: string, current: PackingSnapshot, results?: WorkingResults) {
  return createPlanVersion({
    versionId,
    name: versionId,
    createdAt: `2026-10-06T${versionId.length}:00:00.000Z`,
    snapshot: current,
    results: results ?? createWorkingResults(current.suitcase, current.items),
  });
}

describe('compareVersions', () => {
  it('compares additions, removals, identity weight and frozen loading differences', () => {
    const sharedBefore = item('shared', '保持物品');
    const sharedAfter = { ...sharedBefore, weight: 3 };
    const baseSnapshot = snapshot([sharedBefore, item('removed', '只在旧版')]);
    const targetSnapshot = snapshot([sharedAfter, item('added', '只在新版')]);
    const targetResults = createWorkingResults(targetSnapshot.suitcase, targetSnapshot.items);
    targetResults.plans.minimal.placements = targetResults.plans.minimal.placements.filter((placement) => placement.itemId !== 'shared');
    targetResults.plans.minimal.unplaced.push({ item: sharedAfter, reason: '测试冻结差异' });

    const diff = compareVersions(version('base', baseSnapshot), version('target', targetSnapshot, targetResults));
    expect(diff.addedItems.map((entry) => entry.itemId)).toEqual(['added']);
    expect(diff.removedItems.map((entry) => entry.itemId)).toEqual(['removed']);
    const changed = diff.changedItems.find((entry) => entry.itemId === 'shared');
    expect(changed?.weightDelta).toBe(2);
    expect(changed?.attributeChanges.some((change) => change.field === 'weight')).toBe(true);
    expect(changed?.planDifferences.minimal.state).toBe('unplaced');
    expect(changed?.planDifferences.minimal.beforeState).toBe('placed');
    expect(diff.planSummaries.minimal.placedDelta).toBe(-1);
    expect(diff.totalItemWeightDelta).toBe(2);
  });

  it('does not merge items merely because their names match', () => {
    const base = version('base', snapshot([item('old-charger', '充电器')]));
    const target = version('target', snapshot([item('new-charger', '充电器')]));
    const diff = compareVersions(base, target);
    expect(diff.removedItems.map((entry) => entry.itemId)).toEqual(['old-charger']);
    expect(diff.addedItems.map((entry) => entry.itemId)).toEqual(['new-charger']);
    expect(diff.changedItems).toEqual([]);
    expect(diff.sameNameItems).toEqual([{ name: '充电器', baseIds: ['old-charger'], targetIds: ['new-charger'] }]);
  });

  it('preserves rules version on frozen versions', () => {
    const frozen = version('v1', snapshot([item('a')]));
    expect(frozen.results.rulesVersion).toBe(PACKING_RULES_VERSION);
  });
});

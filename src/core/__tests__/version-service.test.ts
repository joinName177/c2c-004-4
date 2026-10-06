import { describe, expect, it } from 'vitest';
import { createSampleSnapshot } from '../sample-data';
import { compareAllPlans, comparePlanVersions, createPlanningVersion, recomputeVersion } from '../version-service';
import type { PackingItem, PlanningVersion } from '../models';

const item = (id: string, name = '物品', patch: Partial<PackingItem> = {}): PackingItem => ({
  id,
  name,
  category: '其他',
  length: 10,
  width: 10,
  height: 5,
  weight: 1,
  priority: 2,
  mustHave: false,
  ...patch,
});

describe('planning versions', () => {
  it('freezes suitcase, item attributes, all plans and risks', () => {
    const snapshot = createSampleSnapshot();
    const version = createPlanningVersion('国庆行程', snapshot, '2026-10-06T00:00:00.000Z');

    expect(version.name).toBe('国庆行程');
    expect(version.suitcase).toEqual(snapshot.suitcase);
    expect(version.items).toEqual(snapshot.items);
    expect(Object.keys(version.plans)).toEqual(['minimal', 'comfort', 'shopping']);
    expect(Object.keys(version.risks)).toEqual(['minimal', 'comfort', 'shopping']);
    expect(version.risks.comfort.length).toBeGreaterThan(0);

    snapshot.items[0].name = '被改动的当前物品';
    expect(version.items[0].name).toBe('轻薄外套');
  });

  it('compares additions, removals, weights and packing state by item identity', () => {
    const first = createPlanningVersion('旧版', {
      suitcase: { length: 50, width: 40, height: 20, maxWeight: 10 },
      selectedPlan: 'comfort',
      items: [item('shirt-1', 'T恤', { weight: 1 }), item('kept', '长裤', { weight: 2 })],
    });
    const second = createPlanningVersion('新版', {
      suitcase: { length: 50, width: 40, height: 20, maxWeight: 10 },
      selectedPlan: 'comfort',
      items: [item('shirt-2', 'T恤', { weight: 1 }), item('kept', '长裤', { weight: 2.5 })],
    });

    const diff = comparePlanVersions(first, second, 'comfort');

    expect(diff.added.map((entry) => entry.id)).toEqual(['shirt-2']);
    expect(diff.removed.map((entry) => entry.id)).toEqual(['shirt-1']);
    expect(diff.changed).toEqual([expect.objectContaining({ itemId: 'kept', weightDelta: 0.5 })]);
    expect(diff.weightDelta).toBe(second.plans.comfort.totalWeight - first.plans.comfort.totalWeight);
  });

  it('reports suitcase attribute changes when comparing versions', () => {
    const first = createPlanningVersion('小箱', { suitcase: { length: 40, width: 30, height: 20, maxWeight: 8 }, selectedPlan: 'minimal', items: [] });
    const second = createPlanningVersion('大箱', { suitcase: { length: 50, width: 30, height: 20, maxWeight: 9 }, selectedPlan: 'minimal', items: [] });
    const diff = comparePlanVersions(first, second, 'minimal');

    expect(diff.suitcaseChanges).toContain('长度 40 → 50 cm');
    expect(diff.suitcaseChanges).toContain('承重 8 → 9 kg');
  });

  it('does not merge same-named items with different identities', () => {
    const versions = [
      createPlanningVersion('A', { suitcase: { length: 100, width: 100, height: 100, maxWeight: 100 }, selectedPlan: 'minimal', items: [item('a', '同名')] }),
      createPlanningVersion('B', { suitcase: { length: 100, width: 100, height: 100, maxWeight: 100 }, selectedPlan: 'minimal', items: [item('b', '同名')] }),
    ];
    const diff = compareAllPlans(versions[0], versions[1]).minimal;

    expect(diff.added[0].id).toBe('b');
    expect(diff.removed[0].id).toBe('a');
    expect(diff.changed).toHaveLength(0);
  });

  it('recalculates into a new version and leaves the historical version untouched', () => {
    const source: PlanningVersion = {
      ...createPlanningVersion('旧规则方案', createSampleSnapshot()),
      ruleVersion: 'old-rule',
    };
    const recalculated = recomputeVersion(source, '新规则方案');

    expect(recalculated.id).not.toBe(source.id);
    expect(recalculated.sourceVersionId).toBe(source.id);
    expect(recalculated.name).toBe('新规则方案');
    expect(source.ruleVersion).toBe('old-rule');
    expect(source.name).toBe('旧规则方案');
  });
});

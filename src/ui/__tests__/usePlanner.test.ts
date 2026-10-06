import { describe, expect, it } from 'vitest';
import { createSampleWorkspace } from '../../core/sample-data';
import { usePlanner } from '../usePlanner';
import { createWorkingResults } from '../../core/plan-service';
import { PACKING_RULES_VERSION, type PlanVersion, type PlannerWorkspace } from '../../core/models';
import { createPlanVersion } from '../../core/version-service';
import type { PlannerRepository } from '../../ports/planner-repository.port';

class MemoryRepository implements PlannerRepository {
  saved?: PlannerWorkspace;
  throwOnSave = false;
  constructor(public workspace: PlannerWorkspace = createSampleWorkspace()) {}
  loadWorkspace() { return { value: structuredClone(this.workspace) }; }
  saveWorkspace(workspace: PlannerWorkspace) {
    if (this.throwOnSave) throw new Error('storage full');
    this.saved = structuredClone(workspace);
    this.workspace = structuredClone(workspace);
  }
}

function plannerWith(repository = new MemoryRepository()) {
  return usePlanner({ repository, printPort: { print() {} } });
}

function versionFrom(workspace: PlannerWorkspace, name: string, overrides: Partial<PlanVersion> = {}): PlanVersion {
  return createPlanVersion({
    snapshot: workspace.current,
    results: workspace.workingResults!,
    name,
    versionId: name,
    createdAt: `2026-10-06T${name.length}:00:00.000Z`,
    ...overrides,
  });
}

describe('usePlanner', () => {
  it('adds, updates and removes items while marking results stale', () => {
    const repository = new MemoryRepository();
    const planner = plannerWith(repository);
    const initial = planner.state.items.length;
    planner.addItem({ id: 'new', name: '帽子', category: '衣物', length: 12, width: 12, height: 5, weight: 0.2, priority: 2, mustHave: false });
    expect(planner.state.items).toHaveLength(initial + 1);
    expect(planner.isStale.value).toBe(true);
    planner.updateItem('new', { name: '遮阳帽' });
    expect(planner.state.items.find((item) => item.id === 'new')?.name).toBe('遮阳帽');
    planner.removeItem('new');
    expect(planner.state.items).toHaveLength(initial);
  });

  it('regenerates plans and persists the selected mode', () => {
    const repository = new MemoryRepository();
    const planner = plannerWith(repository);
    planner.updateSuitcase({ maxWeight: 12 });
    expect(planner.isStale.value).toBe(true);
    planner.regenerate();
    planner.selectPlan('shopping');
    expect(planner.isStale.value).toBe(false);
    expect(planner.plans.value.shopping.name).toBe('购物版');
    expect(repository.saved?.current.selectedPlan).toBe('shopping');
  });

  it('freezes a named version with inputs, all three plans, risks and rules version', () => {
    const planner = plannerWith();
    const version = planner.saveVersion('认可方案');
    expect(version.results.plans.minimal.name).toBe('精简版');
    expect(version.results.risks.comfort.length).toBeGreaterThan(0);
    expect(version.results.rulesVersion).toBe(PACKING_RULES_VERSION);
    expect(planner.versions.value[0].name).toBe('认可方案');
  });

  it('refuses to freeze stale results until plans are regenerated', () => {
    const planner = plannerWith();
    planner.updateItem(planner.state.items[0].id, { weight: 5 });
    expect(() => planner.saveVersion('过早保存')).toThrow('请先');
    expect(planner.versions.value).toHaveLength(0);
    planner.regenerate();
    expect(planner.saveVersion('重新计算后').name).toBe('重新计算后');
  });

  it('opens old versions read-only and compares same-name items by identity', () => {
    const repository = new MemoryRepository();
    const baseWorkspace = createSampleWorkspace();
    const base = versionFrom(baseWorkspace, 'base');
    const targetWorkspace = createSampleWorkspace();
    targetWorkspace.current.items = [
      ...baseWorkspace.current.items.map((item) => ({ ...item })),
      { id: 'coat-a', name: '外套', category: '衣物', length: 10, width: 10, height: 2, weight: 0.5, priority: 2, mustHave: false },
    ];
    targetWorkspace.workingResults = createWorkingResults(targetWorkspace.current.suitcase, targetWorkspace.current.items);
    const target = versionFrom(targetWorkspace, 'target');
    targetWorkspace.versions = [target, base];
    repository.workspace = targetWorkspace;
    const planner = plannerWith(repository);

    const beforeName = planner.state.items[0].name;
    planner.viewVersion(base.versionId);
    expect(planner.viewingVersion.value?.versionId).toBe('base');
    planner.updateItem(planner.state.items[0].id, { name: '当前编辑' });
    expect(planner.viewingVersion.value?.items[0].name).toBe(beforeName);

    planner.setComparison('base', base.versionId);
    planner.setComparison('target', target.versionId);
    expect(planner.versionDifference.value?.addedItems.some((item) => item.itemId === 'coat-a')).toBe(true);
    expect(planner.versionDifference.value?.sameNameItems.some((entry) => entry.name === '轻薄外套')).toBe(false);
  });

  it('keeps same-name items separate in the identity comparison', () => {
    const repository = new MemoryRepository();
    const first = createSampleWorkspace();
    const second = createSampleWorkspace();
    second.current.items = [{ ...first.current.items[0], id: 'replacement', name: first.current.items[0].name, weight: 9 }];
    second.workingResults = createWorkingResults(second.current.suitcase, second.current.items);
    first.versions = [versionFrom(second, 'target'), versionFrom(first, 'base')];
    repository.workspace = first;
    const planner = plannerWith(repository);
    planner.setComparison('base', 'base');
    planner.setComparison('target', 'target');
    const diff = planner.versionDifference.value!;
    expect(diff.removedItems.some((item) => item.itemId === first.current.items[0].id)).toBe(true);
    expect(diff.addedItems.some((item) => item.itemId === 'replacement')).toBe(true);
    expect(diff.sameNameItems.some((entry) => entry.name === first.current.items[0].name)).toBe(true);
  });

  it('marks persisted but unrecalculated input stale after reload instead of showing stale edits as synchronized', () => {
    const repository = new MemoryRepository();
    const workspace = createSampleWorkspace();
    workspace.current.suitcase = { ...workspace.current.suitcase, length: 99 };
    repository.workspace = workspace;
    const planner = plannerWith(repository);
    expect(planner.isStale.value).toBe(true);
    expect(planner.state.suitcase.length).toBe(99);
    expect(planner.workingResults.value.plans.comfort.placements[0].dimensions.length).toBeLessThan(50);
  });

  it('backs up current state, restores frozen results, and leaves history unchanged', () => {
    const repository = new MemoryRepository();
    const oldWorkspace = createSampleWorkspace();
    oldWorkspace.current.suitcase.maxWeight = 7;
    oldWorkspace.workingResults = createWorkingResults(oldWorkspace.current.suitcase, oldWorkspace.current.items);
    const old = versionFrom(oldWorkspace, 'old');
    const currentWorkspace = createSampleWorkspace();
    currentWorkspace.versions = [old];
    repository.workspace = currentWorkspace;
    const planner = plannerWith(repository);
    const currentMaxWeight = planner.state.suitcase.maxWeight;

    planner.restoreVersion('old', '恢复前备份');

    expect(planner.state.suitcase.maxWeight).toBe(7);
    expect(planner.workingResults.value.rulesVersion).toBe(old.results.rulesVersion);
    expect(planner.viewingVersion.value).toBeNull();
    const backup = planner.versions.value.find((version) => version.source === 'restore-backup');
    expect(backup?.suitcase.maxWeight).toBe(currentMaxWeight);
    expect(planner.versions.value.find((version) => version.versionId === 'old')?.suitcase.maxWeight).toBe(7);
  });

  it('leaves current state untouched when restore cannot persist', () => {
    const repository = new MemoryRepository();
    const oldWorkspace = createSampleWorkspace();
    oldWorkspace.current.suitcase.maxWeight = 6;
    oldWorkspace.workingResults = createWorkingResults(oldWorkspace.current.suitcase, oldWorkspace.current.items);
    repository.saved = undefined;
    const planner = plannerWith(repository);
    const old = versionFrom(oldWorkspace, 'old');
    planner.versions.value = [old];
    planner.viewVersion('old');
    repository.throwOnSave = true;

    expect(() => planner.restoreVersion('old', '备份')).toThrow('storage full');
    expect(planner.state.suitcase.maxWeight).toBe(10);
    expect(planner.workingResults.value.plans).not.toBe(old.results.plans);
    expect(planner.viewingVersion.value?.versionId).toBe('old');
  });

  it('recalculates an old version into a new version without mutating it', () => {
    const repository = new MemoryRepository();
    const workspace = createSampleWorkspace();
    const old = versionFrom(workspace, 'old', { results: { ...workspace.workingResults!, rulesVersion: 'legacy.v0' } });
    workspace.versions = [old];
    repository.workspace = workspace;
    const planner = plannerWith(repository);

    const recalculated = planner.recalculateVersion('old', '按新规则重算');
    expect(recalculated.results.rulesVersion).toBe(PACKING_RULES_VERSION);
    expect(planner.versions.value.find((version) => version.versionId === 'old')?.results.rulesVersion).toBe('legacy.v0');
    expect(planner.viewingVersion.value?.versionId).toBe(recalculated.versionId);
  });
});

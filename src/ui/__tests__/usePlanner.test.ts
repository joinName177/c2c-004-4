import { describe, expect, it } from 'vitest';
import { createSampleSnapshot } from '../../core/sample-data';
import { usePlanner } from '../usePlanner';
import type { PlannerWorkspace } from '../../core/models';
import type { PlannerRepository } from '../../ports/planner-repository.port';

class MemoryRepository implements PlannerRepository {
  saved?: PlannerWorkspace;
  failSave = false;
  constructor(private workspace: PlannerWorkspace = { ...createSampleSnapshot(), versions: [] }) {}
  load() { return { value: JSON.parse(JSON.stringify(this.workspace)) }; }
  save(workspace: PlannerWorkspace) {
    if (this.failSave) throw new Error('storage full');
    this.saved = JSON.parse(JSON.stringify(workspace));
    this.workspace = JSON.parse(JSON.stringify(workspace));
  }
}

const printPort = { print() {} };

describe('usePlanner', () => {
  it('adds, updates and removes items while marking results stale', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort });
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
    const planner = usePlanner({ repository, printPort });
    planner.updateSuitcase({ maxWeight: 12 });
    expect(planner.isStale.value).toBe(true);
    planner.regenerate();
    planner.selectPlan('shopping');
    expect(planner.isStale.value).toBe(false);
    expect(planner.plans.value.shopping.name).toBe('购物版');
    expect(repository.saved?.selectedPlan).toBe('shopping');
  });

  it('freezes a named version only after current plans are regenerated', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort });
    planner.addItem({ id: 'hat', name: '帽子', category: '衣物', length: 12, width: 12, height: 5, weight: 0.2, priority: 2, mustHave: false });
    expect(planner.saveVersion('国庆方案')).toBe(false);
    expect(planner.versions.value).toHaveLength(0);

    planner.regenerate();
    expect(planner.saveVersion('国庆方案')).toBe(true);
    expect(planner.versions.value[0].name).toBe('国庆方案');
    expect(planner.versions.value[0].plans.comfort.placements).toBeDefined();
    expect(planner.versions.value[0].risks.comfort).toBeDefined();
  });

  it('does not allow duplicate version names', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort });
    expect(planner.saveVersion('同一个名字')).toBe(true);
    expect(planner.saveVersion('同一个名字')).toBe(false);
    expect(planner.versions.value).toHaveLength(1);
  });

  it('views an old version without changing the current editable snapshot', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort });
    planner.saveVersion('冻结版');
    planner.addItem({ id: 'new-current', name: '当前新物品', category: '其他', length: 5, width: 5, height: 5, weight: 0.1, priority: 1, mustHave: false });
    const currentLength = planner.state.items.length;

    planner.viewVersion(planner.versions.value[0].id);
    expect(planner.viewedVersion.value?.name).toBe('冻结版');
    expect(planner.state.items).toHaveLength(currentLength);
    expect(planner.state.items.at(-1)?.id).toBe('new-current');

    planner.viewVersion(null);
    expect(planner.viewedVersion.value).toBeNull();
    expect(planner.state.items).toHaveLength(currentLength);
  });

  it('restores a version and preserves the pre-restore current state as a new version', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort });
    planner.saveVersion('最初认可');
    const targetId = planner.versions.value[0].id;
    planner.regenerate();
    planner.addItem({ id: 'later-item', name: '后来添加', category: '其他', length: 5, width: 5, height: 5, weight: 0.1, priority: 1, mustHave: false });
    planner.regenerate();
    const beforeItemCount = planner.state.items.length;

    expect(planner.restoreVersion(targetId)).toBe(true);
    expect(planner.state.items).toHaveLength(beforeItemCount - 1);
    expect(planner.state.items.some((item) => item.id === 'later-item')).toBe(false);
    expect(planner.versions.value).toHaveLength(2);
    expect(planner.versions.value[0].items.some((item) => item.id === 'later-item')).toBe(true);
    expect(planner.versions.value[1].id).toBe(targetId);
    expect(planner.isStale.value).toBe(false);
  });

  it('keeps the current state unchanged when restoration cannot be persisted', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort });
    planner.saveVersion('目标版本');
    const targetId = planner.versions.value[0].id;
    planner.addItem({ id: 'keep-me', name: '保留物品', category: '其他', length: 5, width: 5, height: 5, weight: 0.1, priority: 1, mustHave: false });
    const snapshot = JSON.stringify(planner.state);
    repository.failSave = true;

    expect(planner.restoreVersion(targetId)).toBe(false);
    expect(JSON.stringify(planner.state)).toBe(snapshot);
    expect(planner.notice.value).toContain('恢复失败');
  });

  it('recalculates an old version as a new version without rewriting history or current state', () => {
    const repository = new MemoryRepository();
    const planner = usePlanner({ repository, printPort });
    planner.saveVersion('旧方案');
    const oldVersion = planner.versions.value[0];
    planner.addItem({ id: 'current-only', name: '当前专属', category: '其他', length: 5, width: 5, height: 5, weight: 0.1, priority: 1, mustHave: false });

    expect(planner.recalculateVersion(oldVersion.id, '新规则方案')).toBe(true);
    expect(planner.versions.value[0].name).toBe('新规则方案');
    expect(planner.versions.value[0].sourceVersionId).toBe(oldVersion.id);
    expect(planner.versions.value[1]).toEqual(oldVersion);
    expect(planner.state.items.some((item) => item.id === 'current-only')).toBe(true);
  });
});

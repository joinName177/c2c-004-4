import { beforeEach, describe, expect, it } from 'vitest';
import { LocalPlannerRepository } from '../local-planner.repository';
import { createSampleSnapshot, createSampleWorkspace } from '../../core/sample-data';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe('LocalPlannerRepository', () => {
  const storage = new MemoryStorage();
  beforeEach(() => storage.clear());

  it('round trips a planning workspace and named versions', () => {
    const repo = new LocalPlannerRepository(storage);
    const workspace = createSampleWorkspace();
    const version = { ...workspace.current, versionId: 'v1', name: '国庆行程', createdAt: '2026-10-06T10:00:00.000Z', source: 'manual' as const, results: workspace.workingResults! };
    workspace.versions = [version];
    repo.saveWorkspace(workspace);
    const loaded = repo.loadWorkspace().value;
    expect(loaded.current.suitcase.length).toBe(52);
    expect(loaded.versions[0].name).toBe('国庆行程');
    expect(loaded.versions[0].results.plans.comfort.placements.length).toBeGreaterThan(0);
  });

  it('returns sample workspace when storage is empty', () => {
    const result = new LocalPlannerRepository(storage).loadWorkspace();
    expect(result.value.current.items.length).toBeGreaterThan(0);
    expect(result.value.workingResults?.plans.shopping.name).toBe('购物版');
    expect(result.warning).toBeUndefined();
  });

  it('returns sample workspace and a warning for malformed JSON', () => {
    storage.setItem('c2c-004.planner', '{bad');
    const result = new LocalPlannerRepository(storage).loadWorkspace();
    expect(result.value.current.items.length).toBeGreaterThan(0);
    expect(result.warning).toContain('已恢复示例');
  });

  it('migrates a legacy snapshot without changing its historical inputs', () => {
    const legacy = { ...createSampleSnapshot(), suitcase: { ...createSampleSnapshot().suitcase, length: 61 } };
    storage.setItem('c2c-004.planner', JSON.stringify(legacy));
    const result = new LocalPlannerRepository(storage).loadWorkspace();
    expect(result.value.current.suitcase.length).toBe(61);
    expect(result.value.versions).toEqual([]);
    expect(result.value.workingResults?.plans.minimal.id).toBe('minimal');
  });
});

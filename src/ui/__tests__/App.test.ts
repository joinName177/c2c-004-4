import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import App from '../App.vue';
import { LocalPlannerRepository } from '../../adapters/local-planner.repository';
import { createSampleWorkspace } from '../../core/sample-data';
import { createPlanVersion } from '../../core/version-service';
import type { PlannerWorkspace } from '../../core/models';
import type { PlannerRepository } from '../../ports/planner-repository.port';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

function cloneWorkspace(workspace: PlannerWorkspace): PlannerWorkspace {
  return JSON.parse(JSON.stringify(workspace)) as PlannerWorkspace;
}

class ControlledRepository implements PlannerRepository {
  saved?: PlannerWorkspace;
  constructor(private workspace: PlannerWorkspace = createSampleWorkspace(), private failSave = false) {}
  loadWorkspace() { return { value: cloneWorkspace(this.workspace) }; }
  saveWorkspace(workspace: PlannerWorkspace) {
    if (this.failSave) throw new Error('storage unavailable');
    this.saved = cloneWorkspace(workspace);
    this.workspace = cloneWorkspace(workspace);
  }
}

function render(repository?: PlannerRepository) {
  let printCount = 0;
  const wrapper = mount(App, { props: {
    repository: repository ?? new LocalPlannerRepository(new MemoryStorage()),
    printPort: { print: () => { printCount += 1; } },
  } });
  return { wrapper, getPrintCount: () => printCount };
}

describe('Luggage planner App', () => {
  it('renders sample luggage and catches invalid dimensions', async () => {
    const { wrapper } = render();
    expect(wrapper.text()).toContain('行李箱空间规划师');
    expect(wrapper.text()).toContain('轻薄外套');
    await wrapper.get('[aria-label="行李箱长度"]').setValue('0');
    expect(wrapper.text()).toContain('行李箱长度必须大于 0');
  });

  it('adds and deletes an item', async () => {
    const { wrapper } = render();
    await wrapper.get('[aria-label="物品名称"]').setValue('新物品');
    await wrapper.get('[data-testid="item-editor"]').trigger('submit');
    expect(wrapper.text()).toContain('新物品');
    await wrapper.get('[aria-label="删除 新物品"]').trigger('click');
    expect(wrapper.text()).not.toContain('新物品');
  });

  it('selects a plan and highlights the same item in both projections', async () => {
    const { wrapper } = render();
    await wrapper.get('[data-plan="shopping"]').trigger('click');
    expect(wrapper.get('[data-plan="shopping"]').classes()).toContain('active');
    const jacket = wrapper.findAll('[data-item-id="jacket"]');
    expect(jacket.length).toBe(2);
    await jacket[0].trigger('click');
    expect(wrapper.findAll('[data-item-id="jacket"].selected')).toHaveLength(2);
  });

  it('delegates printing through the print port', async () => {
    const { wrapper, getPrintCount } = render();
    await wrapper.get('[data-testid="print-button"]').trigger('click');
    expect(getPrintCount()).toBe(1);
  });

  it('freezes, views and compares a named version without changing current edits', async () => {
    const { wrapper } = render();
    await wrapper.get('[aria-label="版本名称"]').setValue('周末行程');
    await wrapper.get('[data-testid="version-save-form"]').trigger('submit');
    expect(wrapper.text()).toContain('周末行程');

    await wrapper.get('[aria-label="物品名称"]').setValue('当前草稿物品');
    await wrapper.get('[data-testid="item-editor"]').trigger('submit');
    await wrapper.get('[data-version-id] button').trigger('click');
    expect(wrapper.get('[data-testid="version-viewer"]').text()).toContain('周末行程');
    expect(wrapper.get('[data-testid="version-viewer"]').text()).not.toContain('当前草稿物品');
    expect(wrapper.text()).toContain('当前草稿物品');
    expect(wrapper.get('[data-testid="version-compare"]').text()).toContain('周末行程');
  });

  it('previews restore, creates a backup and applies the frozen version', async () => {
    const workspace = createSampleWorkspace();
    const old = createPlanVersion({
      snapshot: { ...workspace.current, suitcase: { ...workspace.current.suitcase, maxWeight: 6 } },
      results: workspace.workingResults!,
      name: '轻箱旧版',
      versionId: 'old-version',
      createdAt: '2026-10-06T09:00:00.000Z',
    });
    workspace.versions = [old];
    const repository = new ControlledRepository(workspace);
    const { wrapper } = render(repository);

    await wrapper.get('[data-version-id="old-version"] button').trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === '恢复此版本')!.trigger('click');
    expect(wrapper.get('[data-testid="restore-preview"]').text()).toContain('将被替换');
    await wrapper.get('[data-testid="confirm-restore"]').trigger('click');
    expect(wrapper.findAll('[data-testid="version-viewer"]')).toHaveLength(0);
    expect(repository.saved?.versions.some((version) => version.source === 'restore-backup')).toBe(true);
    expect(repository.saved?.current.suitcase.maxWeight).toBe(6);
  });

  it('keeps the current state untouched when restoring fails', async () => {
    const workspace = createSampleWorkspace();
    const old = createPlanVersion({ snapshot: workspace.current, results: workspace.workingResults!, name: '旧版', versionId: 'old', createdAt: '2026-10-06T09:00:00.000Z' });
    workspace.versions = [old];
    const repository = new ControlledRepository(workspace, true);
    const { wrapper } = render(repository);

    await wrapper.get('[data-version-id="old"] button').trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === '恢复此版本')!.trigger('click');
    await wrapper.get('[data-testid="confirm-restore"]').trigger('click');
    expect(wrapper.get('[data-testid="restore-error"]').text()).toContain('恢复失败');
    expect(wrapper.find('[data-testid="version-viewer"]').element).toBeTruthy();
  });

  it('recalculates an old-rules version into a separate new version', async () => {
    const workspace = createSampleWorkspace();
    const old = createPlanVersion({
      snapshot: workspace.current,
      results: { ...workspace.workingResults!, rulesVersion: 'legacy.v0' },
      name: '历史规则版',
      versionId: 'legacy',
      createdAt: '2026-10-06T08:00:00.000Z',
    });
    workspace.versions = [old];
    const repository = new ControlledRepository(workspace);
    const { wrapper } = render(repository);

    await wrapper.get('[data-version-id="legacy"] button').trigger('click');
    expect(wrapper.get('[data-testid="old-rules-banner"]').text()).toContain('不会自动重算');
    await wrapper.findAll('button').find((button) => button.text() === '按当前规则重算为新版本')!.trigger('click');
    await wrapper.get('[aria-label="重算版本名称"]').setValue('新规则结果');
    await wrapper.get('[data-testid="recalc-form"]').trigger('submit');
    expect(repository.saved?.versions.find((version) => version.versionId === 'legacy')?.results.rulesVersion).toBe('legacy.v0');
    expect(repository.saved?.versions.some((version) => version.name === '新规则结果')).toBe(true);
  });
});

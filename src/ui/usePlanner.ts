import { computed, reactive, ref } from 'vue';
import { createSampleSnapshot } from '../core/sample-data';
import { generatePlans } from '../core/plan-service';
import { detectRisks } from '../core/risk-engine';
import { createPlanningVersion, recomputeVersion, snapshotFromVersion } from '../core/version-service';
import type { PackingItem, PackingSnapshot, PlanningVersion, PlannerWorkspace, PlanMode, Suitcase } from '../core/models';
import type { PlannerRepository } from '../ports/planner-repository.port';
import type { PrintPort } from '../ports/print.port';

export interface PlannerDependencies { repository: PlannerRepository; printPort: PrintPort }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueName(base: string, names: string[]) {
  if (!names.includes(base)) return base;
  let index = 2;
  while (names.includes(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function usePlanner({ repository, printPort }: PlannerDependencies) {
  const loaded = repository.load();
  const state = reactive<PlannerWorkspace>({ ...loaded.value, versions: loaded.value.versions ?? [] });
  const notice = ref(loaded.warning ?? '');
  const isStale = ref(false);
  const viewedVersionId = ref<string | null>(null);
  const plans = ref(generatePlans(state.suitcase, state.items));
  const currentPlan = computed(() => plans.value[state.selectedPlan]);
  const risks = computed(() => detectRisks(currentPlan.value, state.suitcase, state.items));
  const versions = computed(() => state.versions);
  const viewedVersion = computed(() => state.versions.find((version) => version.id === viewedVersionId.value) ?? null);
  const currentPreview = computed(() => createPlanningVersion('__current_restore_preview__', {
    suitcase: clone(state.suitcase),
    items: clone(state.items),
    selectedPlan: state.selectedPlan,
  }));

  const persist = () => repository.save(clone(state));
  const save = persist;
  const markStale = () => { isStale.value = true; save(); };
  function currentSnapshot(): PackingSnapshot {
    return { suitcase: clone(state.suitcase), items: clone(state.items), selectedPlan: state.selectedPlan };
  }

  function addItem(item: PackingItem) { state.items.push(item); markStale(); }
  function updateItem(id: string, patch: Partial<PackingItem>) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items[index] = { ...state.items[index], ...patch } as PackingItem;
    markStale();
  }
  function removeItem(id: string) { state.items = state.items.filter((item) => item.id !== id); markStale(); }
  function updateSuitcase(patch: Partial<Suitcase>) { Object.assign(state.suitcase, patch); markStale(); }
  function regenerate() { plans.value = generatePlans(state.suitcase, state.items); isStale.value = false; notice.value = '三套方案已重新计算'; save(); }
  function selectPlan(mode: PlanMode) { state.selectedPlan = mode; save(); }
  function resetSample() {
    const sample = createSampleSnapshot();
    Object.assign(state, sample, { versions: state.versions });
    plans.value = generatePlans(state.suitcase, state.items);
    isStale.value = false;
    viewedVersionId.value = null;
    notice.value = '已恢复登机箱示例';
    save();
  }

  function saveVersion(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) {
      notice.value = '请先为规划版本命名。';
      return false;
    }
    if (state.versions.some((version) => version.name === trimmed)) {
      notice.value = '已存在同名规划版本，请换一个名称。';
      return false;
    }
    if (isStale.value) {
      notice.value = '当前清单有修改，请先重新计算三套方案，再冻结版本。';
      return false;
    }
    try {
      const version = createPlanningVersion(trimmed, currentSnapshot());
      const nextVersions = [version, ...state.versions];
      repository.save({ ...currentSnapshot(), versions: clone(nextVersions), selectedPlan: state.selectedPlan });
      state.versions = nextVersions;
      notice.value = `版本“${trimmed}”已冻结保存。`;
      return true;
    } catch {
      notice.value = '版本保存失败，当前编辑内容未改变。';
      return false;
    }
  }

  function viewVersion(id: string | null) {
    viewedVersionId.value = id;
  }

  function restoreVersion(id: string): boolean {
    const target = state.versions.find((version) => version.id === id);
    if (!target) {
      notice.value = '未找到要恢复的版本。';
      return false;
    }
    try {
      const backupName = uniqueName(`恢复前状态 ${new Date().toLocaleString('zh-CN', { hour12: false })}`, state.versions.map((version) => version.name));
      const backup = createPlanningVersion(backupName, currentSnapshot());
      const restoredSnapshot = snapshotFromVersion(target);
      const next: PlannerWorkspace = { ...clone(restoredSnapshot), versions: [backup, ...clone(state.versions)] };
      repository.save(next);
      state.suitcase = clone(target.suitcase);
      state.items = clone(target.items);
      state.selectedPlan = target.selectedPlan;
      state.versions = next.versions;
      plans.value = clone(target.plans);
      isStale.value = false;
      viewedVersionId.value = null;
      notice.value = `已恢复版本“${target.name}”，恢复前状态已另存为“${backupName}”。`;
      return true;
    } catch {
      notice.value = '恢复失败，当前编辑内容保持原样。';
      return false;
    }
  }

  function recalculateVersion(id: string, name: string): boolean {
    const source = state.versions.find((version) => version.id === id);
    const trimmed = name.trim();
    if (!source) {
      notice.value = '未找到要重算的旧版本。';
      return false;
    }
    if (!trimmed) {
      notice.value = '请先为按新规则生成的版本命名。';
      return false;
    }
    if (state.versions.some((version) => version.name === trimmed)) {
      notice.value = '已存在同名规划版本，请换一个名称。';
      return false;
    }
    try {
      const recalculated = recomputeVersion(source, trimmed);
      const nextVersions = [recalculated, ...state.versions];
      const snapshot = currentSnapshot();
      repository.save({ ...snapshot, versions: clone(nextVersions) });
      state.versions = nextVersions;
      viewedVersionId.value = recalculated.id;
      notice.value = `已按当前规则生成新版本“${trimmed}”，旧版本保持不变。`;
      return true;
    } catch {
      notice.value = '按新规则重算失败，当前编辑内容和旧版本均未改变。';
      return false;
    }
  }

  return {
    state,
    notice,
    isStale,
    plans,
    currentPlan,
    risks,
    versions,
    viewedVersion,
    currentPreview,
    viewVersion,
    saveVersion,
    restoreVersion,
    recalculateVersion,
    addItem,
    updateItem,
    removeItem,
    updateSuitcase,
    regenerate,
    selectPlan,
    resetSample,
    print: () => printPort.print(),
  };
}

import { computed, reactive, ref, shallowRef } from 'vue';
import { createSampleSnapshot } from '../core/sample-data';
import { createWorkingResults } from '../core/plan-service';
import { detectRisks } from '../core/risk-engine';
import { PACKING_RULES_VERSION, PLAN_MODES, type PackingItem, type PackingSnapshot, type PlanMode, type PlanVersion, type RiskSet, type Suitcase, type WorkingResults } from '../core/models';
import { compareVersions, createPlanVersion, type VersionDifference } from '../core/version-service';
import type { PlannerRepository } from '../ports/planner-repository.port';
import type { PrintPort } from '../ports/print.port';

export interface PlannerDependencies { repository: PlannerRepository; printPort: PrintPort }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function snapshotFrom(value: PackingSnapshot): PackingSnapshot {
  return { suitcase: clone(value.suitcase), items: clone(value.items), selectedPlan: value.selectedPlan };
}
function hydrateResults(results: WorkingResults | undefined, snapshot: PackingSnapshot): WorkingResults {
  if (!results?.rulesVersion || !results.plans) return createWorkingResults(snapshot.suitcase, snapshot.items);
  const risks = PLAN_MODES.reduce((result, mode) => {
    result[mode] = Array.isArray(results.risks?.[mode]) ? results.risks[mode] : detectRisks(results.plans[mode], snapshot.suitcase, snapshot.items);
    return result;
  }, {} as RiskSet);
  return { ...results, rulesVersion: results.rulesVersion ?? 'unknown', risks };
}

export function usePlanner({ repository, printPort }: PlannerDependencies) {
  const loaded = repository.loadWorkspace();
  const state = reactive<PackingSnapshot>(loaded.value.current);
  const committed = reactive<PackingSnapshot>(loaded.value.committed ?? clone(loaded.value.current));
  const loadedVersions = (loaded.value.versions ?? []).map((version) => ({ ...version, results: hydrateResults(version.results, version) }));
  const versions = shallowRef<PlanVersion[]>(loadedVersions);
  const initialResults = hydrateResults(loaded.value.workingResults, committed);
  const workingResults = shallowRef<WorkingResults>(initialResults);
  const notice = ref(loaded.warning ?? '');
  const isStale = ref(JSON.stringify(snapshotFrom(state)) !== JSON.stringify(snapshotFrom(committed)));
  const plans = computed(() => workingResults.value.plans);
  const currentPlan = computed(() => plans.value[state.selectedPlan]);
  const risks = computed(() => workingResults.value.risks[state.selectedPlan] ?? detectRisks(currentPlan.value, state.suitcase, state.items));
  const isRuleStale = computed(() => workingResults.value.rulesVersion !== PACKING_RULES_VERSION);

  const viewingVersionId = ref<string | null>(null);
  const viewingVersion = computed(() => versions.value.find((version) => version.versionId === viewingVersionId.value) ?? null);
  const comparisonBaseId = ref(versions.value[0]?.versionId ?? '');
  const comparisonTargetId = ref(versions.value[1]?.versionId ?? versions.value[0]?.versionId ?? '');
  const versionDifference = computed<VersionDifference | null>(() => {
    const base = versions.value.find((version) => version.versionId === comparisonBaseId.value);
    const target = versions.value.find((version) => version.versionId === comparisonTargetId.value);
    return base && target ? compareVersions(base, target) : null;
  });

  function persist() {
    repository.saveWorkspace({
      current: snapshotFrom(state),
      committed: snapshotFrom(committed),
      workingResults: clone(workingResults.value),
      versions: clone(versions.value),
    });
  }

  function addVersions(nextVersions: PlanVersion[]) {
    repository.saveWorkspace({
      current: snapshotFrom(state),
      committed: snapshotFrom(committed),
      workingResults: clone(workingResults.value),
      versions: clone(nextVersions),
    });
    versions.value = nextVersions;
  }

  const save = () => persist();
  const markStale = () => { isStale.value = true; save(); };

  function addItem(item: PackingItem) { state.items.push(item); markStale(); }
  function updateItem(id: string, patch: Partial<PackingItem>) {
    const index = state.items.findIndex((item) => item.id === id);
    if (index >= 0) state.items[index] = { ...state.items[index], ...patch } as PackingItem;
    markStale();
  }
  function removeItem(id: string) { state.items = state.items.filter((item) => item.id !== id); markStale(); }
  function updateSuitcase(patch: Partial<Suitcase>) { Object.assign(state.suitcase, patch); markStale(); }

  function replaceSnapshot(target: PackingSnapshot, next: PackingSnapshot) {
    target.suitcase = clone(next.suitcase);
    target.items = clone(next.items);
    target.selectedPlan = next.selectedPlan;
  }

  function regenerate() {
    const nextResults = createWorkingResults(state.suitcase, state.items);
    repository.saveWorkspace({ current: snapshotFrom(state), committed: snapshotFrom(state), workingResults: clone(nextResults), versions: clone(versions.value) });
    replaceSnapshot(committed, state);
    workingResults.value = nextResults;
    isStale.value = false;
    notice.value = '三套方案已按当前规则重新计算';
  }
  function selectPlan(mode: PlanMode) {
    state.selectedPlan = mode;
    committed.selectedPlan = mode;
    save();
  }
  function resetSample() {
    const sample = createSampleSnapshot();
    const nextResults = createWorkingResults(sample.suitcase, sample.items);
    repository.saveWorkspace({ current: clone(sample), committed: clone(sample), workingResults: clone(nextResults), versions: clone(versions.value) });
    replaceSnapshot(state, sample);
    replaceSnapshot(committed, sample);
    workingResults.value = nextResults;
    isStale.value = false;
    notice.value = '已恢复登机箱示例；已保存的版本仍然保留';
  }

  function requireSynced() {
    if (isStale.value) throw new Error('请先按当前输入重新计算三套方案，再冻结为版本。');
  }

  function saveVersion(name: string): PlanVersion {
    requireSynced();
    const frozen = createPlanVersion({ snapshot: committed, results: workingResults.value, name });
    const nextVersions = [frozen, ...versions.value];
    addVersions(nextVersions);
    comparisonBaseId.value = nextVersions.find((version) => version.versionId !== frozen.versionId)?.versionId ?? frozen.versionId;
    comparisonTargetId.value = frozen.versionId;
    notice.value = `已冻结版本「${frozen.name}」`;
    return frozen;
  }

  function viewVersion(versionId: string | null) {
    viewingVersionId.value = versionId;
  }

  function setComparison(role: 'base' | 'target', versionId: string) {
    if (role === 'base') comparisonBaseId.value = versionId;
    else comparisonTargetId.value = versionId;
  }

  function restoreVersion(versionId: string, backupName: string) {
    const target = versions.value.find((version) => version.versionId === versionId);
    if (!target) throw new Error('找不到要恢复的版本。');
    if (isStale.value) throw new Error('当前输入有尚未重算的调整，请先重算或放弃这些调整后再恢复。');
    const backup = createPlanVersion({ snapshot: committed, results: workingResults.value, name: backupName, source: 'restore-backup' });
    const nextVersions = [backup, ...versions.value];
    const nextCurrent = snapshotFrom(target);
    const nextResults = clone(target.results);
    repository.saveWorkspace({ current: nextCurrent, committed: clone(nextCurrent), workingResults: nextResults, versions: nextVersions });

    replaceSnapshot(state, nextCurrent);
    replaceSnapshot(committed, nextCurrent);
    workingResults.value = nextResults;
    versions.value = nextVersions;
    isStale.value = false;
    viewingVersionId.value = null;
    comparisonBaseId.value = backup.versionId;
    comparisonTargetId.value = target.versionId;
    notice.value = `已恢复「${target.name}」，恢复前的状态已保存为「${backup.name}」`;
  }

  function recalculateVersion(versionId: string, name: string): PlanVersion {
    const source = versions.value.find((version) => version.versionId === versionId);
    if (!source) throw new Error('找不到要重算的版本。');
    const results = createWorkingResults(source.suitcase, source.items);
    const recalculated = createPlanVersion({ snapshot: source, results, name, source: 'recalculated' });
    const nextVersions = [recalculated, ...versions.value];
    addVersions(nextVersions);
    viewingVersionId.value = recalculated.versionId;
    comparisonBaseId.value = source.versionId;
    comparisonTargetId.value = recalculated.versionId;
    notice.value = `已按当前规则生成新版本「${recalculated.name}」，原版本保持不变`;
    return recalculated;
  }

  return {
    state,
    notice,
    isStale,
    isRuleStale,
    workingResults,
    plans,
    currentPlan,
    risks,
    versions,
    viewingVersionId,
    viewingVersion,
    comparisonBaseId,
    comparisonTargetId,
    versionDifference,
    addItem,
    updateItem,
    removeItem,
    updateSuitcase,
    regenerate,
    selectPlan,
    resetSample,
    saveVersion,
    viewVersion,
    setComparison,
    restoreVersion,
    recalculateVersion,
    print: () => printPort.print(),
  };
}

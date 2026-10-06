import { createSampleWorkspace } from '../core/sample-data';
import { PACKING_RULES_VERSION, type PackingSnapshot, type PlanVersion, type PlannerWorkspace } from '../core/models';
import { createWorkingResults } from '../core/plan-service';
import type { LoadResult, PlannerRepository } from '../ports/planner-repository.port';

const KEY = 'c2c-004.planner';

function isSnapshot(value: unknown): value is PackingSnapshot {
  const candidate = value as PackingSnapshot | null;
  return Boolean(candidate && candidate.suitcase && Array.isArray(candidate.items) && candidate.selectedPlan);
}

function isPlanVersion(value: unknown): value is PlanVersion {
  const candidate = value as PlanVersion | null;
  return Boolean(candidate && isSnapshot(candidate) && candidate.versionId && candidate.name && candidate.createdAt && candidate.results?.plans);
}

function cloneSnapshot(snapshot: PackingSnapshot): PackingSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as PackingSnapshot;
}

function migrateWorkspace(value: unknown): PlannerWorkspace {
  if (value && typeof value === 'object' && 'current' in value) {
    const workspace = value as PlannerWorkspace;
    if (!isSnapshot(workspace.current)) throw new Error('invalid workspace');
    return {
      current: workspace.current,
      committed: workspace.committed,
      workingResults: workspace.workingResults,
      versions: Array.isArray(workspace.versions) ? workspace.versions.filter(isPlanVersion) : [],
    };
  }
  if (isSnapshot(value)) {
    return { current: value, committed: cloneSnapshot(value), workingResults: createWorkingResults(value.suitcase, value.items), versions: [] };
  }
  throw new Error('invalid workspace');
}

export class LocalPlannerRepository implements PlannerRepository {
  constructor(private readonly storage: Storage) {}

  loadWorkspace(): LoadResult<PlannerWorkspace> {
    const raw = this.storage.getItem(KEY);
    if (!raw) return { value: createSampleWorkspace() };
    try {
      const workspace = migrateWorkspace(JSON.parse(raw) as unknown);
      if (workspace.workingResults && workspace.workingResults.rulesVersion !== PACKING_RULES_VERSION) {
        return { value: workspace, warning: '当前结果由旧版装箱规则生成，可继续查看；需要时请手动按新规则重算。' };
      }
      return { value: workspace };
    } catch {
      return { value: createSampleWorkspace(), warning: '本地数据无法读取，已恢复示例。' };
    }
  }

  saveWorkspace(workspace: PlannerWorkspace): void {
    this.storage.setItem(KEY, JSON.stringify(workspace));
  }
}

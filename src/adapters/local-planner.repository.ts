import { createSampleSnapshot } from '../core/sample-data';
import type { PlannerWorkspace } from '../core/models';
import type { LoadResult, PlannerRepository } from '../ports/planner-repository.port';

const KEY = 'c2c-004.planner';

export class LocalPlannerRepository implements PlannerRepository {
  constructor(private readonly storage: Storage) {}

  load(): LoadResult<PlannerWorkspace> {
    const raw = this.storage.getItem(KEY);
    if (!raw) return { value: { ...createSampleSnapshot(), versions: [] } };
    try {
      const parsed = JSON.parse(raw) as Partial<PlannerWorkspace>;
      if (!parsed.suitcase || !Array.isArray(parsed.items) || !parsed.selectedPlan) {
        return { value: { ...createSampleSnapshot(), versions: [] }, warning: '本地版本数据不完整，已恢复示例。' };
      }
      return { value: { ...parsed, suitcase: parsed.suitcase, items: parsed.items, selectedPlan: parsed.selectedPlan, versions: Array.isArray(parsed.versions) ? parsed.versions : [] } as PlannerWorkspace };
    } catch {
      return { value: { ...createSampleSnapshot(), versions: [] }, warning: '本地数据无法读取，已恢复示例。' };
    }
  }

  save(workspace: PlannerWorkspace): void {
    this.storage.setItem(KEY, JSON.stringify(workspace));
  }
}

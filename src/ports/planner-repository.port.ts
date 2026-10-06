import type { PlannerWorkspace } from '../core/models';

export interface LoadResult<T> { value: T; warning?: string }
export interface PlannerRepository {
  load(): LoadResult<PlannerWorkspace>;
  save(workspace: PlannerWorkspace): void;
}

import type { PlannerWorkspace } from '../core/models';

export interface LoadResult<T> { value: T; warning?: string }
export interface PlannerRepository {
  loadWorkspace(): LoadResult<PlannerWorkspace>;
  saveWorkspace(workspace: PlannerWorkspace): void;
}

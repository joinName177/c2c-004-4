export type Dimensions = Readonly<{ length: number; width: number; height: number }>;
export type PlanMode = 'minimal' | 'comfort' | 'shopping';
export type RiskSeverity = 'critical' | 'warning' | 'info';
export const PLAN_MODES: PlanMode[] = ['minimal', 'comfort', 'shopping'];
export const PACKING_RULES_VERSION = '2026-10-05.v1';

export interface Suitcase extends Dimensions {
  maxWeight: number;
}

export interface PackingItem extends Dimensions {
  id: string;
  name: string;
  category: string;
  weight: number;
  priority: 1 | 2 | 3;
  mustHave: boolean;
  fragile?: boolean;
}

export interface Placement {
  itemId: string;
  x: number;
  y: number;
  z: number;
  dimensions: Dimensions;
}

export interface PackingPlan {
  id: PlanMode;
  name: string;
  placements: Placement[];
  unplaced: Array<{ item: PackingItem; reason: string }>;
  totalWeight: number;
  usedVolume: number;
  capacityRatio: number;
}

export type PlanSet = Record<PlanMode, PackingPlan>;
export type RiskSet = Record<PlanMode, Risk[]>;

export interface Risk {
  id: string;
  severity: RiskSeverity;
  title: string;
  message: string;
  itemId?: string;
}

export interface WorkingResults {
  plans: PlanSet;
  risks: RiskSet;
  rulesVersion: string;
}

export interface PackingSnapshot {
  suitcase: Suitcase;
  items: PackingItem[];
  selectedPlan: PlanMode;
}

export interface PlanVersion extends PackingSnapshot {
  versionId: string;
  name: string;
  createdAt: string;
  source: 'manual' | 'restore-backup' | 'recalculated';
  results: WorkingResults;
}

export interface PlannerWorkspace {
  current: PackingSnapshot;
  committed?: PackingSnapshot;
  workingResults?: WorkingResults;
  versions: PlanVersion[];
}

export function itemVolume(item: Dimensions): number {
  return item.length * item.width * item.height;
}

export function suitcaseVolume(suitcase: Dimensions): number {
  return suitcase.length * suitcase.width * suitcase.height;
}

export type Dimensions = Readonly<{ length: number; width: number; height: number }>;
export type PlanMode = 'minimal' | 'comfort' | 'shopping';
export type RiskSeverity = 'critical' | 'warning' | 'info';

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

export interface Risk {
  id: string;
  severity: RiskSeverity;
  title: string;
  message: string;
  itemId?: string;
}

export interface PackingSnapshot {
  suitcase: Suitcase;
  items: PackingItem[];
  selectedPlan: PlanMode;
}

export interface PlanningVersion {
  id: string;
  name: string;
  createdAt: string;
  ruleVersion: string;
  suitcase: Suitcase;
  items: PackingItem[];
  selectedPlan: PlanMode;
  plans: Record<PlanMode, PackingPlan>;
  risks: Record<PlanMode, Risk[]>;
  sourceVersionId?: string;
}

export interface VersionItemChange {
  itemId: string;
  name: string;
  oldName: string;
  oldWeight: number;
  newWeight: number;
  weightDelta: number;
  attributeDeltas: string[];
}

export interface VersionPackingDifference {
  itemId: string;
  name: string;
  fromPlaced: boolean;
  toPlaced: boolean;
  detail: string;
}

export interface VersionPlanDiff {
  mode: PlanMode;
  fromName: string;
  toName: string;
  suitcaseChanges: string[];
  added: PackingItem[];
  removed: PackingItem[];
  changed: VersionItemChange[];
  packingDifferences: VersionPackingDifference[];
  weightDelta: number;
  fromPlacedCount: number;
  toPlacedCount: number;
  fromUnplacedCount: number;
  toUnplacedCount: number;
}

export interface PlannerWorkspace extends PackingSnapshot {
  versions: PlanningVersion[];
}

export function itemVolume(item: Dimensions): number {
  return item.length * item.width * item.height;
}

export function suitcaseVolume(suitcase: Dimensions): number {
  return suitcase.length * suitcase.width * suitcase.height;
}

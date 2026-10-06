import { detectRisks } from './risk-engine';
import { generatePlans } from './plan-service';
import type {
  PackingItem,
  PackingPlan,
  PackingSnapshot,
  PlanningVersion,
  PlanMode,
  Risk,
  Suitcase,
  VersionPlanDiff,
} from './models';

const PLAN_MODES: PlanMode[] = ['minimal', 'comfort', 'shopping'];
export const PACKING_RULE_VERSION = '2026-10-heuristic-v1';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function detectAllRisks(plans: Record<PlanMode, PackingPlan>, suitcase: Suitcase, items: PackingItem[]): Record<PlanMode, Risk[]> {
  return {
    minimal: detectRisks(plans.minimal, suitcase, items),
    comfort: detectRisks(plans.comfort, suitcase, items),
    shopping: detectRisks(plans.shopping, suitcase, items),
  };
}

export function createPlanningVersion(name: string, snapshot: PackingSnapshot, createdAtIso = new Date().toISOString()): PlanningVersion {
  const plans = generatePlans(snapshot.suitcase, snapshot.items);
  return {
    id: `version-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    createdAt: createdAtIso,
    ruleVersion: PACKING_RULE_VERSION,
    suitcase: clone(snapshot.suitcase),
    items: clone(snapshot.items),
    selectedPlan: snapshot.selectedPlan,
    plans: clone(plans),
    risks: clone(detectAllRisks(plans, snapshot.suitcase, snapshot.items)),
  };
}

function isPlacedIn(plan: PackingPlan, itemId: string) {
  return plan.placements.some((placement) => placement.itemId === itemId);
}

function getPlacement(plan: PackingPlan, itemId: string) {
  return plan.placements.find((placement) => placement.itemId === itemId);
}

export function comparePlanVersions(from: PlanningVersion, to: PlanningVersion, mode: PlanMode): VersionPlanDiff {
  const fromPlan = from.plans[mode];
  const toPlan = to.plans[mode];
  const fromById = new Map(from.items.map((item) => [item.id, item]));
  const toById = new Map(to.items.map((item) => [item.id, item]));
  const itemIds = [...new Set([...fromById.keys(), ...toById.keys()])].sort();
  const added: PackingItem[] = [];
  const removed: PackingItem[] = [];
  const changed: VersionPlanDiff['changed'] = [];
  const packingDifferences: VersionPlanDiff['packingDifferences'] = [];
  const suitcaseChanges = [
    from.suitcase.length === to.suitcase.length ? null : `长度 ${from.suitcase.length} → ${to.suitcase.length} cm`,
    from.suitcase.width === to.suitcase.width ? null : `宽度 ${from.suitcase.width} → ${to.suitcase.width} cm`,
    from.suitcase.height === to.suitcase.height ? null : `高度 ${from.suitcase.height} → ${to.suitcase.height} cm`,
    from.suitcase.maxWeight === to.suitcase.maxWeight ? null : `承重 ${from.suitcase.maxWeight} → ${to.suitcase.maxWeight} kg`,
  ].filter((change): change is string => Boolean(change));

  for (const itemId of itemIds) {
    const oldItem = fromById.get(itemId);
    const newItem = toById.get(itemId);

    if (oldItem && !newItem) {
      removed.push(clone(oldItem));
      continue;
    }
    if (newItem && !oldItem) {
      added.push(clone(newItem));
      continue;
    }
    if (!oldItem || !newItem) continue;

    const weightDelta = newItem.weight - oldItem.weight;
    const oldPlaced = isPlacedIn(fromPlan, oldItem.id);
    const newPlaced = isPlacedIn(toPlan, newItem.id);
    const attributeDeltas = [
      oldItem.name === newItem.name ? null : `名称 ${oldItem.name} → ${newItem.name}`,
      oldItem.category === newItem.category ? null : `类别 ${oldItem.category} → ${newItem.category}`,
      oldItem.length === newItem.length ? null : `长度 ${oldItem.length} → ${newItem.length}`,
      oldItem.width === newItem.width ? null : `宽度 ${oldItem.width} → ${newItem.width}`,
      oldItem.height === newItem.height ? null : `高度 ${oldItem.height} → ${newItem.height}`,
      oldItem.priority === newItem.priority ? null : `优先级 P${oldItem.priority} → P${newItem.priority}`,
      oldItem.mustHave === newItem.mustHave ? null : `必带 ${oldItem.mustHave ? '是' : '否'} → ${newItem.mustHave ? '是' : '否'}`,
      Boolean(oldItem.fragile) === Boolean(newItem.fragile) ? null : `易碎 ${oldItem.fragile ? '是' : '否'} → ${newItem.fragile ? '是' : '否'}`,
    ].filter((delta): delta is string => Boolean(delta));
    if (weightDelta !== 0 || attributeDeltas.length) {
      changed.push({ itemId: oldItem.id, name: newItem.name, oldName: oldItem.name, oldWeight: oldItem.weight, newWeight: newItem.weight, weightDelta, attributeDeltas });
    }
    if (oldPlaced !== newPlaced) {
      packingDifferences.push({ itemId: oldItem.id, name: newItem.name, fromPlaced: oldPlaced, toPlaced: newPlaced, detail: newPlaced ? '旧版未装入，新版已装入' : '旧版已装入，新版未装入' });
    } else if (oldPlaced && newPlaced) {
      const oldPlacement = getPlacement(fromPlan, oldItem.id);
      const newPlacement = getPlacement(toPlan, newItem.id);
      const samePosition = oldPlacement && newPlacement
        && oldPlacement.x === newPlacement.x
        && oldPlacement.y === newPlacement.y
        && oldPlacement.z === newPlacement.z
        && oldPlacement.dimensions.length === newPlacement.dimensions.length
        && oldPlacement.dimensions.width === newPlacement.dimensions.width
        && oldPlacement.dimensions.height === newPlacement.dimensions.height;
      if (!samePosition) packingDifferences.push({ itemId: oldItem.id, name: newItem.name, fromPlaced: true, toPlaced: true, detail: '装入位置或摆放方向不同' });
    }
  }

  return {
    mode,
    fromName: from.name,
    toName: to.name,
    suitcaseChanges,
    added,
    removed,
    changed,
    packingDifferences,
    weightDelta: toPlan.totalWeight - fromPlan.totalWeight,
    fromPlacedCount: fromPlan.placements.length,
    toPlacedCount: toPlan.placements.length,
    fromUnplacedCount: fromPlan.unplaced.length,
    toUnplacedCount: toPlan.unplaced.length,
  };
}

export function compareAllPlans(from: PlanningVersion, to: PlanningVersion): Record<PlanMode, VersionPlanDiff> {
  return {
    minimal: comparePlanVersions(from, to, 'minimal'),
    comfort: comparePlanVersions(from, to, 'comfort'),
    shopping: comparePlanVersions(from, to, 'shopping'),
  };
}

export function snapshotFromVersion(version: PlanningVersion): PackingSnapshot {
  return { suitcase: clone(version.suitcase), items: clone(version.items), selectedPlan: version.selectedPlan };
}

export function recomputeVersion(version: PlanningVersion, name: string, ruleVersion = PACKING_RULE_VERSION, createdAtIso = new Date().toISOString()): PlanningVersion {
  const snapshot = snapshotFromVersion(version);
  const recomputed = createPlanningVersion(name, snapshot, createdAtIso);
  recomputed.sourceVersionId = version.id;
  recomputed.ruleVersion = ruleVersion;
  return recomputed;
}

export function planModes(): PlanMode[] {
  return [...PLAN_MODES];
}

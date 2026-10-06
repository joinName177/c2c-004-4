import { PLAN_MODES, type PackingItem, type PackingSnapshot, type PlanMode, type PlanSet, type PlanVersion, type Suitcase, type WorkingResults } from './models';

export type VersionSource = PlanVersion['source'];

export interface AttributeChange {
  field: string;
  label: string;
  before: string | number | boolean;
  after: string | number | boolean;
}

export interface PlanLoadDifference {
  mode: PlanMode;
  state: 'placed' | 'unplaced' | 'missing';
  beforeState?: 'placed' | 'unplaced' | 'missing';
  positionChanged?: boolean;
  reason?: string;
}

export interface ItemVersionDifference {
  itemId: string;
  name: string;
  status: 'added' | 'removed' | 'present';
  weightBefore?: number;
  weightAfter?: number;
  weightDelta?: number;
  attributeChanges: AttributeChange[];
  planDifferences: Record<PlanMode, PlanLoadDifference>;
}

export interface SuitcaseChange {
  field: keyof Suitcase;
  label: string;
  before: number;
  after: number;
}

export interface PlanSummaryDifference {
  mode: PlanMode;
  name: string;
  weightBefore: number;
  weightAfter: number;
  weightDelta: number;
  placedBefore: number;
  placedAfter: number;
  placedDelta: number;
  unplacedBefore: number;
  unplacedAfter: number;
  unplacedDelta: number;
}

export interface SameNameItems {
  name: string;
  baseIds: string[];
  targetIds: string[];
}

export interface VersionDifference {
  baseVersionId: string;
  targetVersionId: string;
  suitcaseChanges: SuitcaseChange[];
  addedItems: ItemVersionDifference[];
  removedItems: ItemVersionDifference[];
  changedItems: ItemVersionDifference[];
  planSummaries: Record<PlanMode, PlanSummaryDifference>;
  totalItemWeightBefore: number;
  totalItemWeightAfter: number;
  totalItemWeightDelta: number;
  sameNameItems: SameNameItems[];
}

const ATTRIBUTE_FIELDS: Array<{ field: keyof PackingItem; label: string }> = [
  { field: 'name', label: '名称' },
  { field: 'category', label: '类别' },
  { field: 'length', label: '长' },
  { field: 'width', label: '宽' },
  { field: 'height', label: '高' },
  { field: 'weight', label: '重量' },
  { field: 'priority', label: '优先级' },
  { field: 'mustHave', label: '必带' },
  { field: 'fragile', label: '易碎' },
];

const SUITCASE_FIELDS: Array<{ field: keyof Suitcase; label: string }> = [
  { field: 'length', label: '长度' },
  { field: 'width', label: '宽度' },
  { field: 'height', label: '高度' },
  { field: 'maxWeight', label: '承重' },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createPlanVersion(options: {
  snapshot: PackingSnapshot;
  results: WorkingResults;
  name: string;
  source?: VersionSource;
  versionId?: string;
  createdAt?: string;
}): PlanVersion {
  const name = options.name.trim();
  if (!name) throw new Error('版本名称不能为空');
  return {
    ...clone(options.snapshot),
    versionId: options.versionId ?? createVersionId(),
    name,
    createdAt: options.createdAt ?? new Date().toISOString(),
    source: options.source ?? 'manual',
    results: clone(options.results),
  };
}

export function createVersionId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `version-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function placedItemIds(plans: PlanSet): Record<PlanMode, Set<string>> {
  return PLAN_MODES.reduce((result, mode) => {
    result[mode] = new Set(plans[mode].placements.map((placement) => placement.itemId));
    return result;
  }, {} as Record<PlanMode, Set<string>>);
}

function unplacedReason(plans: PlanSet, mode: PlanMode, itemId: string): string | undefined {
  return plans[mode].unplaced.find((entry) => entry.item.id === itemId)?.reason;
}

function itemPlanDifference(mode: PlanMode, base: PackingItem | undefined, target: PackingItem | undefined, basePlans: PlanSet, targetPlans: PlanSet): PlanLoadDifference {
  const stateFor = (item: PackingItem | undefined, plans: PlanSet): PlanLoadDifference['state'] => {
    if (!item) return 'missing';
    return placedItemIds(plans)[mode].has(item.id) ? 'placed' : 'unplaced';
  };
  const beforeState = stateFor(base, basePlans);
  const state = stateFor(target, targetPlans);
  const difference: PlanLoadDifference = { mode, state, beforeState };

  if (state === 'unplaced') difference.reason = unplacedReason(targetPlans, mode, target!.id);
  if (beforeState === 'unplaced' && state === 'unplaced') {
    const beforeReason = unplacedReason(basePlans, mode, base!.id);
    if (beforeReason !== difference.reason) difference.reason = difference.reason ? `${beforeReason ?? '未注明'} → ${difference.reason}` : beforeReason;
  }
  if (base && target && beforeState === 'placed' && state === 'placed') {
    const before = basePlans[mode].placements.find((placement) => placement.itemId === base.id)!;
    const after = targetPlans[mode].placements.find((placement) => placement.itemId === target.id)!;
    difference.positionChanged = before.x !== after.x || before.y !== after.y || before.z !== after.z
      || before.dimensions.length !== after.dimensions.length
      || before.dimensions.width !== after.dimensions.width
      || before.dimensions.height !== after.dimensions.height;
  }
  return difference;
}

function attributeDifferences(base: PackingItem, target: PackingItem): AttributeChange[] {
  return ATTRIBUTE_FIELDS.flatMap(({ field, label }) => {
    const before = field === 'fragile' ? Boolean(base[field]) : base[field] as string | number | boolean;
    const after = field === 'fragile' ? Boolean(target[field]) : target[field] as string | number | boolean;
    return before === after ? [] : [{ field, label, before, after }];
  });
}

function itemEntry(status: ItemVersionDifference['status'], base: PackingItem | undefined, target: PackingItem | undefined, basePlans: PlanSet, targetPlans: PlanSet): ItemVersionDifference {
  const item = target ?? base;
  if (!item) throw new Error('A version item must exist on at least one side');
  const weightBefore = base?.weight;
  const weightAfter = target?.weight;
  return {
    itemId: item.id,
    name: item.name,
    status,
    weightBefore,
    weightAfter,
    weightDelta: weightBefore !== undefined && weightAfter !== undefined ? weightAfter - weightBefore : undefined,
    attributeChanges: base && target ? attributeDifferences(base, target) : [],
    planDifferences: PLAN_MODES.reduce((result, mode) => {
      result[mode] = itemPlanDifference(mode, base, target, basePlans, targetPlans);
      return result;
    }, {} as Record<PlanMode, PlanLoadDifference>),
  };
}

function compareSuitcase(base: Suitcase, target: Suitcase): SuitcaseChange[] {
  return SUITCASE_FIELDS.flatMap(({ field, label }) => (
    base[field] === target[field] ? [] : [{ field, label, before: base[field], after: target[field] }]
  ));
}

export function compareVersions(base: PlanVersion, target: PlanVersion): VersionDifference {
  const baseItems = new Map(base.items.map((item) => [item.id, item]));
  const targetItems = new Map(target.items.map((item) => [item.id, item]));
  const addedItems = target.items.filter((item) => !baseItems.has(item.id)).map((item) => itemEntry('added', undefined, item, base.results.plans, target.results.plans));
  const removedItems = base.items.filter((item) => !targetItems.has(item.id)).map((item) => itemEntry('removed', item, undefined, base.results.plans, target.results.plans));
  const changedItems = base.items.flatMap((baseItem) => {
    const targetItem = targetItems.get(baseItem.id);
    if (!targetItem) return [];
    const entry = itemEntry('present', baseItem, targetItem, base.results.plans, target.results.plans);
    const hasLoadDifference = Object.values(entry.planDifferences).some((difference) => difference.state !== difference.beforeState || difference.positionChanged);
    return entry.attributeChanges.length || hasLoadDifference ? [entry] : [];
  });

  const planSummaries = PLAN_MODES.reduce((result, mode) => {
    const before = base.results.plans[mode];
    const after = target.results.plans[mode];
    result[mode] = {
      mode,
      name: after.name,
      weightBefore: before.totalWeight,
      weightAfter: after.totalWeight,
      weightDelta: after.totalWeight - before.totalWeight,
      placedBefore: before.placements.length,
      placedAfter: after.placements.length,
      placedDelta: after.placements.length - before.placements.length,
      unplacedBefore: before.unplaced.length,
      unplacedAfter: after.unplaced.length,
      unplacedDelta: after.unplaced.length - before.unplaced.length,
    };
    return result;
  }, {} as Record<PlanMode, PlanSummaryDifference>);

  const totalItemWeightBefore = base.items.reduce((sum, item) => sum + item.weight, 0);
  const totalItemWeightAfter = target.items.reduce((sum, item) => sum + item.weight, 0);
  const baseNames = new Map<string, string[]>();
  for (const item of base.items) baseNames.set(item.name, [...(baseNames.get(item.name) ?? []), item.id]);
  const targetNames = new Map<string, string[]>();
  for (const item of target.items) targetNames.set(item.name, [...(targetNames.get(item.name) ?? []), item.id]);
  const sameNameItems: SameNameItems[] = [...baseNames.keys()].flatMap((name) => {
    const baseIds = baseNames.get(name) ?? [];
    const targetIds = targetNames.get(name) ?? [];
    if (!targetIds.length) return [];
    const sameIdentities = baseIds.length === targetIds.length && baseIds.every((id, index) => id === targetIds[index]);
    return sameIdentities && baseIds.length === 1 ? [] : [{ name, baseIds, targetIds }];
  });

  return {
    baseVersionId: base.versionId,
    targetVersionId: target.versionId,
    suitcaseChanges: compareSuitcase(base.suitcase, target.suitcase),
    addedItems,
    removedItems,
    changedItems,
    planSummaries,
    totalItemWeightBefore,
    totalItemWeightAfter,
    totalItemWeightDelta: totalItemWeightAfter - totalItemWeightBefore,
    sameNameItems,
  };
}

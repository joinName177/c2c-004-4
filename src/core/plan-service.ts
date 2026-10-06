import { packItems } from './packing-engine';
import { detectRisks } from './risk-engine';
import { PACKING_RULES_VERSION, PLAN_MODES, type PackingItem, type PackingPlan, type PlanMode, type PlanSet, type RiskSet, type Suitcase, type WorkingResults } from './models';

export function generatePlans(suitcase: Suitcase, items: PackingItem[]): PlanSet {
  return {
    minimal: packItems(suitcase, items, 'minimal'),
    comfort: packItems(suitcase, items, 'comfort'),
    shopping: packItems(suitcase, items, 'shopping'),
  };
}

export function createWorkingResults(suitcase: Suitcase, items: PackingItem[], rulesVersion = PACKING_RULES_VERSION): WorkingResults {
  const plans = generatePlans(suitcase, items);
  const risks = PLAN_MODES.reduce((result, mode) => {
    result[mode] = detectRisks(plans[mode], suitcase, items);
    return result;
  }, {} as RiskSet);
  return { plans, risks, rulesVersion };
}

export function planModes(): PlanMode[] {
  return [...PLAN_MODES];
}

export type { PackingPlan };

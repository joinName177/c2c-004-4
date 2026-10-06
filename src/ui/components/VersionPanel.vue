<script setup lang="ts">
import { computed, ref } from 'vue';
import { PLAN_MODES, type PlanMode, type PlanVersion, type RiskSet } from '../../core/models';
import type { VersionDifference } from '../../core/version-service';

defineProps<{
  versions: PlanVersion[];
  baseId: string;
  targetId: string;
  difference: VersionDifference | null;
  isStale: boolean;
}>();
const emit = defineEmits<{
  save: [name: string];
  view: [versionId: string];
  compare: [role: 'base' | 'target', versionId: string];
}>();

const draftName = ref('');
const defaultName = computed(() => `规划版本 ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
const sourceLabels: Record<PlanVersion['source'], string> = {
  manual: '手动冻结',
  'restore-backup': '恢复前备份',
  recalculated: '新规则重算',
};

function submitSave() {
  emit('save', draftName.value.trim() || defaultName.value);
  draftName.value = '';
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}
function formatNumber(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}
function stateLabel(state: 'placed' | 'unplaced' | 'missing', reason?: string) {
  const label = state === 'placed' ? '装入' : state === 'unplaced' ? `未装${reason ? `：${reason}` : ''}` : '不存在';
  return label;
}
function riskCount(risks: RiskSet, mode: PlanMode) {
  return risks[mode].filter((risk) => risk.severity !== 'info').length;
}
</script>

<template>
  <section class="panel version-panel" data-testid="version-panel">
    <div class="section-title">
      <div><span>04 / NAMED VERSIONS</span><h2>规划版本</h2></div>
      <b>{{ versions.length }} 个冻结版本</b>
    </div>

    <form class="version-save" data-testid="version-save-form" @submit.prevent="submitSave">
      <input v-model="draftName" :placeholder="defaultName" aria-label="版本名称" />
      <button type="submit" class="primary" :disabled="isStale">冻结当前规划</button>
    </form>
    <p v-if="isStale" class="version-warning" data-testid="save-stale-warning">输入已变化，请先重新计算三套方案；版本保存的是当时的箱体、物品、摆放结果和风险。</p>
    <p v-else class="version-hint">将连同三套摆放结果与风险清单一起冻结，之后规则变化也不会改写该版本。</p>

    <div v-if="versions.length" class="version-list">
      <article v-for="version in versions" :key="version.versionId" class="version-row" :data-version-id="version.versionId">
        <div>
          <strong>{{ version.name }}</strong>
          <span>{{ formatDate(version.createdAt) }} · {{ sourceLabels[version.source] }} · {{ version.items.length }} 件</span>
          <small>身份 ID：{{ version.versionId.slice(0, 8) }}</small>
        </div>
        <button type="button" @click="emit('view', version.versionId)">只读查看</button>
      </article>
    </div>
    <p v-else class="empty-versions">还没有冻结版本。认可一版安排后，为它命名并保存。</p>

    <div v-if="versions.length >= 1" class="version-compare" data-testid="version-compare">
      <h3>按物品身份比较</h3>
      <div class="compare-selects">
        <label>旧版
          <select :value="baseId" aria-label="比较基准版本" @change="emit('compare', 'base', ($event.target as HTMLSelectElement).value)">
            <option v-for="version in versions" :key="version.versionId" :value="version.versionId">{{ version.name }}</option>
          </select>
        </label>
        <span>→</span>
        <label>新版
          <select :value="targetId" aria-label="比较目标版本" @change="emit('compare', 'target', ($event.target as HTMLSelectElement).value)">
            <option v-for="version in versions" :key="version.versionId" :value="version.versionId">{{ version.name }}</option>
          </select>
        </label>
      </div>

      <div v-if="difference" class="difference-summary">
        <p>清单总重量：{{ difference.totalItemWeightBefore.toFixed(1) }}kg → {{ difference.totalItemWeightAfter.toFixed(1) }}kg <b :class="difference.totalItemWeightDelta > 0 ? 'up' : difference.totalItemWeightDelta < 0 ? 'down' : ''">{{ formatNumber(difference.totalItemWeightDelta) }}kg</b></p>
        <p>物品：新增 {{ difference.addedItems.length }} / 删除 {{ difference.removedItems.length }} / 属性或装入差异 {{ difference.changedItems.length }}</p>
      </div>

      <div v-if="difference && difference.suitcaseChanges.length" class="diff-block">
        <h4>箱体变化</h4>
        <p v-for="change in difference.suitcaseChanges" :key="change.field">{{ change.label }}：{{ change.before }} → {{ change.after }}</p>
      </div>

      <div class="diff-table-wrapper">
        <table class="diff-table">
          <thead><tr><th>物品（按 ID）</th><th>状态 / 重量</th><th v-for="mode in PLAN_MODES" :key="mode">{{ mode === 'minimal' ? '精简' : mode === 'comfort' ? '舒适' : '购物' }}</th></tr></thead>
          <tbody>
            <tr v-for="item in [...difference?.addedItems ?? [], ...difference?.removedItems ?? [], ...difference?.changedItems ?? []]" :key="item.itemId" :class="item.status" :data-item-id="item.itemId">
              <td><strong>{{ item.name }}</strong><small>{{ item.itemId }}</small><em v-if="item.attributeChanges.length">{{ item.attributeChanges.map(change => `${change.label} ${change.before}→${change.after}`).join('；') }}</em></td>
              <td>{{ item.status === 'added' ? '新增' : item.status === 'removed' ? '删除' : '保留' }}<small v-if="item.weightDelta !== undefined">重量 {{ formatNumber(item.weightDelta) }}kg</small></td>
              <td v-for="mode in PLAN_MODES" :key="mode">
                <b>{{ stateLabel(item.planDifferences[mode].state, item.planDifferences[mode].reason) }}</b>
                <small v-if="item.planDifferences[mode].positionChanged">位置/朝向变化</small>
                <small v-else-if="item.planDifferences[mode].state !== item.planDifferences[mode].beforeState">原：{{ stateLabel(item.planDifferences[mode].beforeState ?? 'missing') }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="plan-diff-grid">
        <article v-for="summary in Object.values(difference?.planSummaries ?? {})" :key="summary.mode">
          <strong>{{ summary.name }}</strong>
          <span>重量 {{ summary.weightBefore.toFixed(1) }}→{{ summary.weightAfter.toFixed(1) }}kg（{{ formatNumber(summary.weightDelta) }}）</span>
          <span>装入 {{ summary.placedBefore }}→{{ summary.placedAfter }} 件</span>
          <span>未装 {{ summary.unplacedBefore }}→{{ summary.unplacedAfter }} 件</span>
        </article>
      </div>

      <div v-if="difference?.sameNameItems.length" class="same-name-warning" data-testid="same-name-warning">
        <h4>同名物品未合并</h4>
        <p v-for="entry in difference.sameNameItems" :key="entry.name">「{{ entry.name }}」仍按身份比较：旧版 [{{ entry.baseIds.join(', ') }}] / 新版 [{{ entry.targetIds.join(', ') }}]</p>
      </div>
    </div>
  </section>
</template>

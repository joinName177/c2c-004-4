<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { compareAllPlans, PACKING_RULE_VERSION, planModes } from '../../core/version-service';
import type { PlanningVersion, PlanMode } from '../../core/models';

const props = defineProps<{ versions: PlanningVersion[]; viewedVersion: PlanningVersion | null; currentPreview: PlanningVersion; stale: boolean }>();
const emit = defineEmits<{
  save: [name: string, done: (saved: boolean) => void];
  view: [id: string | null];
  restore: [id: string, done: (restored: boolean) => void];
  recalculate: [id: string, name: string, done: (created: boolean) => void];
}>();

const saveName = ref('');
const compareFromId = ref('');
const compareToId = ref('');
const compareMode = ref<PlanMode>('comfort');
const viewerMode = ref<PlanMode>('comfort');
const restoreTargetId = ref<string | null>(null);
const restoreMode = ref<PlanMode>('comfort');
const recalculateName = ref('');

watch(() => props.versions.map((version) => version.id).join('|'), () => {
  if (!props.versions.some((version) => version.id === compareFromId.value)) compareFromId.value = props.versions[1]?.id ?? '';
  if (!props.versions.some((version) => version.id === compareToId.value)) compareToId.value = props.versions[0]?.id ?? '';
}, { immediate: true });
watch(() => props.viewedVersion?.id, (id) => {
  viewerMode.value = props.versions.find((version) => version.id === id)?.selectedPlan ?? 'comfort';
  recalculateName.value = '';
});

const compareFrom = computed(() => props.versions.find((version) => version.id === compareFromId.value) ?? null);
const compareTo = computed(() => props.versions.find((version) => version.id === compareToId.value) ?? null);
const comparison = computed(() => compareFrom.value && compareTo.value ? compareAllPlans(compareFrom.value, compareTo.value) : null);
const activeDiff = computed(() => comparison.value?.[compareMode.value] ?? null);
const viewerPlan = computed(() => props.viewedVersion?.plans[viewerMode.value] ?? null);
const viewerRisks = computed(() => props.viewedVersion?.risks[viewerMode.value] ?? []);
const restoreTarget = computed(() => props.versions.find((version) => version.id === restoreTargetId.value) ?? null);
const restoreComparison = computed(() => restoreTarget.value ? compareAllPlans(props.currentPreview, restoreTarget.value) : null);
const restoreDiff = computed(() => restoreComparison.value?.[restoreMode.value] ?? null);

function submitSave() {
  emit('save', saveName.value, (saved) => { if (saved) saveName.value = ''; });
}
function openRestore(id: string) {
  restoreTargetId.value = id;
  restoreMode.value = props.currentPreview.selectedPlan;
}
function confirmRestore() {
  const id = restoreTargetId.value;
  if (!id) return;
  emit('restore', id, (restored) => { if (restored) restoreTargetId.value = null; });
}
function submitRecalculate(id: string) {
  emit('recalculate', id, recalculateName.value, (created) => { if (created) recalculateName.value = ''; });
}
function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
function signedWeight(value: number) {
  if (value > 0) return `+${value.toFixed(1)} kg`;
  if (value < 0) return `${value.toFixed(1)} kg`;
  return '±0.0 kg';
}
function placementText(version: PlanningVersion, mode: PlanMode, itemId: string) {
  const plan = version.plans[mode];
  const unplaced = plan.unplaced.find((entry) => entry.item.id === itemId);
  return unplaced ? unplaced.reason : '已装入';
}
</script>

<template>
  <section class="panel version-panel">
    <div class="section-title">
      <div><span>04 / VERSIONS</span><h2>规划版本</h2></div>
      <b>{{ versions.length }} 个冻结版本</b>
    </div>
    <form class="version-save" @submit.prevent="submitSave">
      <input v-model="saveName" aria-label="规划版本名称" placeholder="命名当前规划，如：国庆七日 / 购物返程" />
      <button type="submit" :disabled="stale">冻结保存版本</button>
    </form>
    <p v-if="stale" class="field-error">清单或箱体已修改，先重新计算三套方案后才能冻结。</p>

    <div v-if="versions.length" class="version-list">
      <article v-for="version in versions" :key="version.id" class="version-row">
        <div>
          <strong>{{ version.name }}</strong>
          <span>{{ formatTime(version.createdAt) }} · {{ version.items.length }} 件 · 规则 {{ version.ruleVersion }}</span>
        </div>
        <button type="button" @click="emit('view', version.id)">查看</button>
        <button type="button" @click="openRestore(version.id)">恢复</button>
      </article>
    </div>
    <p v-else class="version-empty">尚无冻结版本。保存后会同时锁定箱体、物品身份、三套摆放结果和风险。</p>

    <div v-if="versions.length >= 2" class="version-compare">
      <h3>按物品身份比较两个版本</h3>
      <div class="compare-controls">
        <label>旧版本<select v-model="compareFromId"><option v-for="version in versions" :key="version.id" :value="version.id">{{ version.name }}</option></select></label>
        <label>新版本<select v-model="compareToId"><option v-for="version in versions" :key="version.id" :value="version.id">{{ version.name }}</option></select></label>
      </div>
      <div v-if="activeDiff && compareFrom && compareTo" class="compare-result" :data-testid="`compare-${compareMode}`">
        <nav>
          <button v-for="mode in planModes()" :key="mode" type="button" :class="{ active: mode === compareMode }" @click="compareMode = mode">{{ mode === 'minimal' ? '精简版' : mode === 'comfort' ? '舒适版' : '购物版' }}</button>
        </nav>
        <div v-if="activeDiff.suitcaseChanges.length" class="suitcase-changes" data-testid="suitcase-changes"><b>箱体变化：</b>{{ activeDiff.suitcaseChanges.join('、') }}</div>
        <div class="compare-summary">
          <span>重量变化 <b :class="activeDiff.weightDelta > 0 ? 'up' : activeDiff.weightDelta < 0 ? 'down' : ''">{{ signedWeight(activeDiff.weightDelta) }}</b></span>
          <span>已装 {{ activeDiff.fromPlacedCount }} → {{ activeDiff.toPlacedCount }}</span>
          <span>未装 {{ activeDiff.fromUnplacedCount }} → {{ activeDiff.toUnplacedCount }}</span>
        </div>
        <div class="compare-columns">
          <div><h4>新增物品</h4><p v-for="item in activeDiff.added" :key="item.id" :data-testid="`added-${item.id}`">{{ item.name }} <small>#{{ item.id }}</small> · +{{ item.weight.toFixed(1) }}kg</p><em v-if="!activeDiff.added.length">无</em></div>
          <div><h4>移除物品</h4><p v-for="item in activeDiff.removed" :key="item.id" :data-testid="`removed-${item.id}`">{{ item.name }} <small>#{{ item.id }}</small> · -{{ item.weight.toFixed(1) }}kg</p><em v-if="!activeDiff.removed.length">无</em></div>
          <div><h4>属性 / 重量变化</h4><p v-for="change in activeDiff.changed" :key="change.itemId" :data-testid="`changed-${change.itemId}`">{{ change.name }} <small>#{{ change.itemId }}</small> · {{ signedWeight(change.weightDelta) }}<template v-if="change.attributeDeltas.length"> · {{ change.attributeDeltas.join('、') }}</template></p><em v-if="!activeDiff.changed.length">无</em></div>
          <div><h4>装入差异</h4><p v-for="difference in activeDiff.packingDifferences" :key="difference.itemId" :data-testid="`packing-${difference.itemId}`">{{ difference.name }} <small>#{{ difference.itemId }}</small> · {{ difference.detail }}</p><em v-if="!activeDiff.packingDifferences.length">无</em></div>
        </div>
        <p class="identity-note">同名物品若身份编号不同，会分别作为新增和移除显示，不会合并。</p>
      </div>
    </div>

    <div v-if="viewedVersion" class="modal-backdrop" data-testid="version-viewer" @click.self="emit('view', null)">
      <div class="viewer-card">
        <header><div><span>FROZEN VERSION</span><h2>{{ viewedVersion.name }}</h2><small>{{ formatTime(viewedVersion.createdAt) }} · 只读回看，不影响当前编辑</small></div><button type="button" aria-label="关闭版本查看" @click="emit('view', null)">×</button></header>
        <div class="viewer-summary">
          <span>箱体 {{ viewedVersion.suitcase.length }}×{{ viewedVersion.suitcase.width }}×{{ viewedVersion.suitcase.height }} cm</span>
          <span>承重 {{ viewedVersion.suitcase.maxWeight }} kg</span>
          <span>物品 {{ viewedVersion.items.length }} 件</span>
          <span>规则 {{ viewedVersion.ruleVersion }}</span>
        </div>
        <nav class="viewer-tabs">
          <button v-for="mode in planModes()" :key="mode" type="button" :class="{ active: mode === viewerMode }" @click="viewerMode = mode">{{ viewedVersion.plans[mode].name }}</button>
        </nav>
        <div v-if="viewerPlan" class="viewer-plan">
          <div class="compare-summary"><span>已装 <b>{{ viewerPlan.placements.length }}</b></span><span>未装 <b>{{ viewerPlan.unplaced.length }}</b></span><span>重量 <b>{{ viewerPlan.totalWeight.toFixed(1) }}kg</b></span><span>空间 <b>{{ Math.round(viewerPlan.capacityRatio * 100) }}%</b></span></div>
          <h3>冻结物品与摆放结果</h3>
          <div class="frozen-items">
            <p v-for="item in viewedVersion.items" :key="item.id" :class="{ unplaced: !viewerPlan.placements.some(p => p.itemId === item.id) }"><b>{{ item.name }}</b><small>#{{ item.id }}</small><span>{{ placementText(viewedVersion, viewerMode, item.id) }}</span></p>
          </div>
          <h3>当时风险</h3>
          <ul class="frozen-risks"><li v-for="risk in viewerRisks" :key="risk.id" :class="risk.severity">{{ risk.title }}：{{ risk.message }}</li></ul>
        </div>
        <form class="recalculate-form" @submit.prevent="submitRecalculate(viewedVersion.id)">
          <label>按当前装箱规则重算为新版本<input v-model="recalculateName" aria-label="重算版本名称" placeholder="新规则重算版本名称" /></label>
          <button type="button" class="secondary" @click="openRestore(viewedVersion.id)">恢复此版本</button>
          <button type="submit" :disabled="viewedVersion.ruleVersion === PACKING_RULE_VERSION">生成新版本</button>
        </form>
        <p class="viewer-note">旧版始终按冻结结果回看；只有点击“生成新版本”才会创建新版本，不会改写历史方案。</p>
        <p v-if="viewedVersion.ruleVersion === PACKING_RULE_VERSION" class="identity-note">该版本已经使用当前装箱规则，暂无新规则可重算。</p>
      </div>
    </div>

    <div v-if="restoreTarget && restoreDiff" class="modal-backdrop" data-testid="restore-dialog" @click.self="restoreTargetId = null">
      <div class="viewer-card restore-card">
        <header><div><span>RESTORE PREVIEW</span><h2>恢复“{{ restoreTarget.name }}”</h2><small>当前内容将被替换，并自动留成一个新版本</small></div><button type="button" aria-label="取消恢复" @click="restoreTargetId = null">×</button></header>
        <div class="replacement-grid">
          <div><h3>将被替换的当前状态</h3><p>箱体 {{ currentPreview.suitcase.length }}×{{ currentPreview.suitcase.width }}×{{ currentPreview.suitcase.height }} cm / {{ currentPreview.suitcase.maxWeight }}kg</p><p>物品 {{ currentPreview.items.length }} 件 · 当前查看 {{ currentPreview.plans[restoreMode].name }}</p><ul><li v-for="item in currentPreview.items" :key="item.id">{{ item.name }} <small>#{{ item.id }}</small> · {{ placementText(currentPreview, restoreMode, item.id) }}</li></ul></div>
          <div><h3>恢复后使用的冻结内容</h3><p>箱体 {{ restoreTarget.suitcase.length }}×{{ restoreTarget.suitcase.width }}×{{ restoreTarget.suitcase.height }} cm / {{ restoreTarget.suitcase.maxWeight }}kg</p><p>物品 {{ restoreTarget.items.length }} 件 · 默认 {{ restoreTarget.plans[restoreMode].name }}</p><ul><li v-for="item in restoreTarget.items" :key="item.id">{{ item.name }} <small>#{{ item.id }}</small> · {{ placementText(restoreTarget, restoreMode, item.id) }}</li></ul></div>
        </div>
        <nav class="viewer-tabs"><button v-for="mode in planModes()" :key="mode" type="button" :class="{ active: mode === restoreMode }" @click="restoreMode = mode">{{ restoreTarget.plans[mode].name }}</button></nav>
        <div class="compare-summary"><span>重量变化 <b>{{ signedWeight(restoreDiff.weightDelta) }}</b></span><span>新增 {{ restoreDiff.added.length }}</span><span>移除 {{ restoreDiff.removed.length }}</span><span>装入差异 {{ restoreDiff.packingDifferences.length }}</span></div>
        <div class="compare-columns compact">
          <div><h4>新增</h4><p v-for="item in restoreDiff.added" :key="item.id">{{ item.name }} <small>#{{ item.id }}</small></p><em v-if="!restoreDiff.added.length">无</em></div>
          <div><h4>移除</h4><p v-for="item in restoreDiff.removed" :key="item.id">{{ item.name }} <small>#{{ item.id }}</small></p><em v-if="!restoreDiff.removed.length">无</em></div>
          <div><h4>重量变化</h4><p v-for="change in restoreDiff.changed" :key="change.itemId">{{ change.name }} <small>#{{ change.itemId }}</small> · {{ signedWeight(change.weightDelta) }}</p><em v-if="!restoreDiff.changed.length">无</em></div>
          <div><h4>装入差异</h4><p v-for="difference in restoreDiff.packingDifferences" :key="difference.itemId">{{ difference.name }} <small>#{{ difference.itemId }}</small> · {{ difference.detail }}</p><em v-if="!restoreDiff.packingDifferences.length">无</em></div>
        </div>
        <footer class="restore-actions"><button type="button" class="secondary" @click="restoreTargetId = null">取消</button><button type="button" class="primary" data-testid="confirm-restore" @click="confirmRestore">确认替换并备份当前状态</button></footer>
      </div>
    </div>
  </section>
</template>

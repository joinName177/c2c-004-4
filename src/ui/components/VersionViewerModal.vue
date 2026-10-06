<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PACKING_RULES_VERSION, PLAN_MODES, type PackingSnapshot, type PlanVersion, type WorkingResults } from '../../core/models';
import PlanCompare from './PlanCompare.vue';
import PackingProjection from './PackingProjection.vue';
import RiskPanel from './RiskPanel.vue';

const props = defineProps<{
  version: PlanVersion | null;
  currentSnapshot: PackingSnapshot;
  currentResults: WorkingResults;
  isStale: boolean;
  error?: string;
  errorKey?: number;
}>();
const emit = defineEmits<{
  close: [];
  restore: [versionId: string, backupName: string];
  recalculate: [versionId: string, name: string];
}>();

const selectedMode = ref<PlanVersion['selectedPlan']>('comfort');
const selectedItem = ref('');
const showRestorePreview = ref(false);
const restoreError = ref('');
const recalculating = ref(false);
const recalcName = ref('');
const recalcError = ref('');

watch(() => props.version?.versionId, () => {
  selectedMode.value = props.version?.selectedPlan ?? 'comfort';
  selectedItem.value = '';
  showRestorePreview.value = false;
  restoreError.value = '';
  recalculating.value = false;
  recalcName.value = '';
  recalcError.value = '';
});
watch(() => props.error, (value) => { restoreError.value = value ?? ''; });
watch(() => props.errorKey, (value) => { restoreError.value = value ? props.error ?? '' : ''; });

const currentPlan = computed(() => props.version?.results.plans[selectedMode.value] ?? null);
const currentRisks = computed(() => props.version?.results.risks[selectedMode.value] ?? []);
const isCurrentRules = computed(() => props.version?.results.rulesVersion === PACKING_RULES_VERSION);
const defaultBackupName = computed(() => `恢复前状态 ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
const defaultRecalcName = computed(() => `${props.version?.name ?? '历史版本'} · 新规则重算`);
const sourceLabels: Record<PlanVersion['source'], string> = {
  manual: '手动冻结',
  'restore-backup': '恢复前备份',
  recalculated: '新规则重算',
};

function close() {
  emit('close');
}
function confirmRestore() {
  if (!props.version) return;
  emit('restore', props.version.versionId, defaultBackupName.value);
}
function startRecalculate() {
  if (!props.version) return;
  if (!recalcName.value.trim()) {
    recalcError.value = '请为按新规则重算后的新版本命名。';
    return;
  }
  emit('recalculate', props.version.versionId, recalcName.value.trim());
}
</script>

<template>
  <div v-if="version" class="version-viewer-backdrop" data-testid="version-viewer" role="dialog" aria-modal="true" aria-label="版本只读查看">
    <div class="version-viewer">
      <header class="viewer-head">
        <div>
          <span>READ-ONLY FROZEN VERSION</span>
          <h2>{{ version.name }}</h2>
          <p>{{ new Date(version.createdAt).toLocaleString('zh-CN', { hour12: false }) }} · {{ sourceLabels[version.source] }} · 规则 {{ version.results.rulesVersion }}</p>
        </div>
        <button type="button" aria-label="关闭版本查看" @click="close">×</button>
      </header>

      <div class="viewer-banner">当前窗口只读；查看旧版本不会改变左侧正在编辑的箱体、物品或当前摆放结果。</div>
      <div v-if="!isCurrentRules" class="viewer-banner old-rules" data-testid="old-rules-banner">该版本按旧装箱规则冻结。系统继续显示原结果，不会自动重算；如需新规则结果，请显式生成另一个新版本。</div>

      <PlanCompare :plans="version.results.plans" :selected="selectedMode" :suitcase="version.suitcase" @select="selectedMode = $event" />
      <section class="viewer-content">
        <div class="viewer-projections">
          <PackingProjection view="top" :plan="currentPlan!" :suitcase="version.suitcase" :items="version.items" :selected-id="selectedItem" @select="selectedItem = $event" />
          <PackingProjection view="side" :plan="currentPlan!" :suitcase="version.suitcase" :items="version.items" :selected-id="selectedItem" @select="selectedItem = $event" />
        </div>
        <RiskPanel :risks="currentRisks" />
      </section>

      <details class="frozen-items">
        <summary>查看冻结的箱体与物品属性（{{ version.items.length }} 件）</summary>
        <p>箱体：{{ version.suitcase.length }}×{{ version.suitcase.width }}×{{ version.suitcase.height }} cm，承重 {{ version.suitcase.maxWeight }}kg</p>
        <ul>
          <li v-for="item in version.items" :key="item.id">{{ item.name }}（ID: {{ item.id }}）— {{ item.length }}×{{ item.width }}×{{ item.height }} cm · {{ item.weight }}kg · {{ item.mustHave ? '必带' : '可选' }}</li>
        </ul>
      </details>

      <p v-if="isStale" class="version-warning">当前输入有尚未重算的调整，请先返回主界面重算后再恢复。</p>
      <footer class="viewer-actions">
        <button type="button" :disabled="isStale" @click="showRestorePreview = true">恢复此版本</button>
        <button v-if="!isCurrentRules" type="button" :class="{ primary: recalculating }" @click="recalculating = !recalculating">按当前规则重算为新版本</button>
      </footer>

      <form v-if="recalculating" class="recalc-form" data-testid="recalc-form" @submit.prevent="startRecalculate">
        <label>新版本名称<input v-model="recalcName" :placeholder="defaultRecalcName" aria-label="重算版本名称" /></label>
        <button type="submit">生成新版本</button>
        <p v-if="recalcError" class="form-error">{{ recalcError }}</p>
        <p class="version-hint">原版本「{{ version.name }}」保持不变。</p>
      </form>

      <div v-if="showRestorePreview" class="restore-preview" data-testid="restore-preview">
        <h3>恢复前确认：以下当前内容将被替换</h3>
        <p>当前正在编辑的箱体、物品属性、三套摆放结果、风险和所选方案，会先另存为新版本：<strong>{{ defaultBackupName }}</strong></p>
        <ul>
          <li v-for="mode in PLAN_MODES" :key="mode">当前 {{ currentResults.plans[mode].name }}：{{ currentResults.plans[mode].placements.length }} 件装入 · {{ currentResults.plans[mode].totalWeight.toFixed(1) }}kg · {{ currentResults.risks[mode].filter(risk => risk.severity !== 'info').length }} 项风险</li>
        </ul>
        <p>当前清单 {{ currentSnapshot.items.length }} 件；目标版本 {{ version.items.length }} 件。恢复后使用目标版本「{{ version.name }}」的原始结果，不按当前规则自动重算。</p>
        <p v-if="restoreError" class="form-error" data-testid="restore-error">{{ restoreError }}</p>
        <div class="restore-actions">
          <button type="button" @click="showRestorePreview = false">取消</button>
          <button type="button" class="danger" data-testid="confirm-restore" :disabled="isStale" @click="confirmRestore">先备份当前状态，再恢复</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { LocalPlannerRepository } from '../adapters/local-planner.repository';
import { BrowserPrintAdapter } from '../adapters/browser-print.adapter';
import { validateSuitcase } from '../core/packing-engine';
import type { PlannerRepository } from '../ports/planner-repository.port';
import type { PrintPort } from '../ports/print.port';
import { usePlanner } from './usePlanner';
import SuitcaseForm from './components/SuitcaseForm.vue';
import ItemEditor from './components/ItemEditor.vue';
import ItemList from './components/ItemList.vue';
import PackingProjection from './components/PackingProjection.vue';
import PlanCompare from './components/PlanCompare.vue';
import RiskPanel from './components/RiskPanel.vue';
import PrintSheet from './components/PrintSheet.vue';
import VersionPanel from './components/VersionPanel.vue';
import VersionViewerModal from './components/VersionViewerModal.vue';

const props = defineProps<{ repository?: PlannerRepository; printPort?: PrintPort }>();
const planner = usePlanner({ repository: props.repository ?? new LocalPlannerRepository(window.localStorage), printPort: props.printPort ?? new BrowserPrintAdapter() });
const selectedItem = ref('');
const errors = computed(() => validateSuitcase(planner.state.suitcase));
const viewerError = ref('');
const viewerErrorKey = ref(0);

function handleSaveVersion(name: string) {
  try {
    viewerError.value = '';
    planner.saveVersion(name);
  } catch (error) {
    planner.notice.value = error instanceof Error ? error.message : '版本保存失败，当前状态未改变。';
  }
}
function handleRestore(versionId: string, backupName: string) {
  try {
    planner.restoreVersion(versionId, backupName);
    viewerError.value = '';
    viewerErrorKey.value += 1;
  } catch (error) {
    viewerError.value = `恢复失败，当前状态保持原样：${error instanceof Error ? error.message : '未知错误'}`;
    viewerErrorKey.value += 1;
    planner.notice.value = viewerError.value;
  }
}
function handleRecalculate(versionId: string, name: string) {
  try {
    planner.recalculateVersion(versionId, name);
    viewerError.value = '';
  } catch (error) {
    viewerError.value = error instanceof Error ? error.message : '重算失败，原版本保持不变。';
    planner.notice.value = viewerError.value;
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar"><div class="brand"><span class="brand-mark">PACK<br><b>WISE</b></span><div><small>TRAVEL LAB / 004</small><h1>行李箱空间规划师</h1></div></div><div class="header-actions"><span :class="{ stale: planner.isStale.value || planner.isRuleStale.value }">{{ planner.isStale.value ? '输入待重算' : planner.isRuleStale.value ? '旧规则结果' : '规划已同步' }}</span><button type="button" data-testid="print-button" @click="planner.print">打印清单</button><button type="button" class="primary" :disabled="errors.length > 0" @click="planner.regenerate">智能装箱 ↗</button></div></header>
    <main>
      <section class="hero"><div><small>SPACE, WEIGHT & PRIORITY</small><h2>把每一寸空间，<em>留给真正认可的安排。</em></h2><p>输入清单，比较三种策略；命名冻结版本，随时按物品身份找回和比较。</p></div><div class="hero-stamp"><b>{{ planner.state.items.length }}</b><span>ITEMS<br>TO PACK</span></div></section>
      <div v-if="planner.isRuleStale.value" class="rule-banner" data-testid="rule-stale-banner">当前工作结果来自旧装箱规则。可以继续按原结果回看；只有点击“智能装箱”或版本内“按当前规则重算”才会生成新结果。</div>
      <PlanCompare :plans="planner.plans.value" :selected="planner.state.selectedPlan" :suitcase="planner.state.suitcase" @select="planner.selectPlan" />
      <div class="workspace">
        <aside class="left-column">
          <SuitcaseForm :suitcase="planner.state.suitcase" :errors="errors" @update="planner.updateSuitcase" />
          <section class="panel inventory"><div class="section-title"><div><span>02 / INVENTORY</span><h2>待装物品</h2></div><b>{{ planner.state.items.length }} 件</b></div><ItemEditor @add="planner.addItem" /><ItemList :items="planner.state.items" @remove="planner.removeItem" @toggle="(id, mustHave) => planner.updateItem(id, { mustHave })" /></section>
          <VersionPanel :versions="planner.versions.value" :base-id="planner.comparisonBaseId.value" :target-id="planner.comparisonTargetId.value" :difference="planner.versionDifference.value" :is-stale="planner.isStale.value" @save="handleSaveVersion" @view="planner.viewVersion" @compare="planner.setComparison" />
        </aside>
        <section class="right-column">
          <div class="canvas-panel"><div class="canvas-head"><div><span>03 / PACKING MAP</span><h2>{{ planner.currentPlan.value.name }}摆放方案</h2></div><div class="metrics"><span><b>{{ Math.round(planner.currentPlan.value.capacityRatio * 100) }}%</b>空间利用</span><span><b>{{ planner.currentPlan.value.totalWeight.toFixed(1) }}</b>kg 已装</span><span><b>{{ planner.currentPlan.value.unplaced.length }}</b>件未装</span></div></div><div class="projections"><PackingProjection view="top" :plan="planner.currentPlan.value" :suitcase="planner.state.suitcase" :items="planner.state.items" :selected-id="selectedItem" @select="selectedItem = $event" /><PackingProjection view="side" :plan="planner.currentPlan.value" :suitcase="planner.state.suitcase" :items="planner.state.items" :selected-id="selectedItem" @select="selectedItem = $event" /></div><p class="canvas-note">点击色块可在两个视图中同步定位物品。摆放坐标以箱体左下后角为原点。</p></div>
          <RiskPanel :risks="planner.risks.value" />
        </section>
      </div>
      <p class="notice" aria-live="polite">{{ planner.notice.value }}</p>
    </main>
    <PrintSheet :suitcase="planner.state.suitcase" :items="planner.state.items" :plan="planner.currentPlan.value" :risks="planner.risks.value" />
    <VersionViewerModal :version="planner.viewingVersion.value" :current-snapshot="planner.state" :current-results="planner.workingResults.value" :is-stale="planner.isStale.value" :error="viewerError" :error-key="viewerErrorKey" @close="planner.viewVersion(null)" @restore="handleRestore" @recalculate="handleRecalculate" />
  </div>
</template>

<script setup lang="ts">
import type { PresentationSlidePreview } from '../../workspace/previewKind';

const props = withDefaults(defineProps<{
  slide: PresentationSlidePreview;
  interactive?: boolean;
  selectedElementId?: string | null;
  slideWidth?: number;
  slideHeight?: number;
  showLabels?: boolean;
}>(), {
  interactive: false,
  selectedElementId: null,
  slideWidth: 13.333,
  slideHeight: 7.5,
  showLabels: false,
});

const emit = defineEmits<{
  selectElement: [elementId: string, text?: string];
}>();

const px = (value: number) => value * 100;
const elementLabel = (type: PresentationSlidePreview['elements'][number]['type']) => ({
  image: '图片', table: '表格', chart: '图表', group: '组合', unsupported: '未知对象',
  shape: '形状', line: '连接线', text: '文本',
}[type]);
const chartValues = (element: PresentationSlidePreview['elements'][number]) =>
  element.chart?.series[0]?.values ?? [];
const chartMax = (element: PresentationSlidePreview['elements'][number]) =>
  Math.max(1, ...chartValues(element).map((value) => Math.abs(value)));
const selectElement = (elementId: string, text?: string) => {
  if (!props.interactive) return;
  emit('selectElement', elementId, text);
};
</script>

<template>
  <svg
    class="presentation-slide-canvas"
    :viewBox="`0 0 ${px(slideWidth)} ${px(slideHeight)}`"
    role="img"
    :aria-label="`幻灯片 ${slide.index} 的近似预览`"
  >
    <rect :width="px(slideWidth)" :height="px(slideHeight)" :fill="`#${slide.background || 'FFFFFF'}`" />
    <g
      v-for="element in slide.elements"
      :key="element.id"
      class="presentation-preview-element"
      :class="{
        'is-interactive': interactive,
        'is-readonly': !element.editable,
        'is-selected': selectedElementId === element.id,
      }"
      :data-element-id="element.id"
      @click.stop="selectElement(element.id, element.texts.join('\n'))"
    >
      <image
        v-if="element.type === 'image' && element.imageDataUrl"
        :x="px(element.x)"
        :y="px(element.y)"
        :width="Math.max(2, px(element.w))"
        :height="Math.max(2, px(element.h))"
        :href="element.imageDataUrl"
        preserveAspectRatio="xMidYMid slice"
      />
      <line
        v-else-if="element.type === 'line'"
        :x1="px(element.x)"
        :y1="px(element.y)"
        :x2="px(element.x + element.w)"
        :y2="px(element.y + element.h)"
        :stroke="`#${element.lineColor || '64748B'}`"
        stroke-width="2"
      />
      <ellipse
        v-else-if="element.type === 'shape' && /ellipse|oval/i.test(element.shapeType || element.name)"
        :cx="px(element.x + element.w / 2)"
        :cy="px(element.y + element.h / 2)"
        :rx="px(element.w / 2)"
        :ry="px(element.h / 2)"
        :fill="`#${element.fill || 'F1F5F9'}`"
        :stroke="`#${element.lineColor || 'CBD5E1'}`"
      />
      <g v-else-if="element.type === 'chart' && chartValues(element).length">
        <rect
          :x="px(element.x)" :y="px(element.y)"
          :width="Math.max(2, px(element.w))" :height="Math.max(2, px(element.h))"
          fill="#FFFFFF" stroke="#CBD5E1"
        />
        <rect
          v-for="(value, valueIndex) in chartValues(element)"
          :key="valueIndex"
          :x="px(element.x) + 18 + valueIndex * Math.max(8, (px(element.w) - 36) / chartValues(element).length)"
          :y="px(element.y + element.h) - 18 - (Math.abs(value) / chartMax(element)) * Math.max(12, px(element.h) - 46)"
          :width="Math.max(4, (px(element.w) - 48) / chartValues(element).length)"
          :height="(Math.abs(value) / chartMax(element)) * Math.max(12, px(element.h) - 46)"
          fill="#2563EB"
          opacity="0.82"
        />
      </g>
      <rect
        v-else
        :x="px(element.x)"
        :y="px(element.y)"
        :width="Math.max(2, px(element.w))"
        :height="Math.max(2, px(element.h))"
        :fill="element.type === 'text' ? 'transparent' : `#${element.fill || 'F1F5F9'}`"
        :stroke="element.type === 'text' ? 'transparent' : `#${element.lineColor || 'CBD5E1'}`"
        :stroke-dasharray="element.editable ? undefined : '8 5'"
        rx="5"
      />
      <g v-if="showLabels" class="presentation-element-debug" pointer-events="none">
        <rect
          :x="px(element.x)"
          :y="px(element.y)"
          :width="Math.max(2, px(element.w))"
          :height="Math.max(2, px(element.h))"
        />
        <text :x="px(element.x) + 4" :y="px(element.y) + 14">{{ element.name || element.id }}</text>
      </g>
      <foreignObject
        v-if="element.type !== 'image' || !element.imageDataUrl"
        :x="px(element.x)"
        :y="px(element.y)"
        :width="Math.max(12, px(element.w))"
        :height="Math.max(12, px(element.h))"
        pointer-events="none"
      >
        <div class="presentation-element-content" :style="{ color: `#${element.textColor || '1F2937'}` }">
          <table v-if="element.type === 'table' && element.rows?.length" class="presentation-table-preview">
            <tbody>
              <tr v-for="(row, rowIndex) in element.rows" :key="rowIndex">
                <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
          <template v-else-if="element.texts.length">
            <div v-for="(text, textIndex) in element.texts" :key="textIndex">{{ text }}</div>
          </template>
          <span v-else>{{ elementLabel(element.type) }}</span>
        </div>
      </foreignObject>
      <rect
        v-if="interactive && selectedElementId === element.id"
        class="presentation-element-selection"
        :x="px(element.x)"
        :y="px(element.y)"
        :width="Math.max(2, px(element.w))"
        :height="Math.max(2, px(element.h))"
      />
    </g>
  </svg>
</template>

<style scoped>
.presentation-slide-canvas {
  display: block;
  width: 100%;
  height: 100%;
  background: #fff;
}
.presentation-preview-element.is-interactive { cursor: pointer; }
.presentation-preview-element.is-interactive.is-readonly { cursor: not-allowed; }
.presentation-preview-element.is-interactive:hover > rect:not(.presentation-element-selection),
.presentation-preview-element.is-interactive:hover > ellipse { stroke: var(--el-color-primary); stroke-width: 3; }
.presentation-element-selection {
  fill: transparent;
  stroke: var(--el-color-primary);
  stroke-width: 3;
  stroke-dasharray: 8 4;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}
.presentation-element-debug rect { fill: transparent; stroke: #f97316; stroke-width: 1.5; stroke-dasharray: 5 4; }
.presentation-element-debug text { fill: #c2410c; font: 11px/1 sans-serif; paint-order: stroke; stroke: #fff; stroke-width: 3px; }
.presentation-element-content {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 5px 7px;
  font: 14px/1.35 "Noto Sans SC", "Microsoft YaHei", sans-serif;
  white-space: pre-wrap;
}
.presentation-table-preview { width: 100%; border-collapse: collapse; font-size: 11px; }
.presentation-table-preview td { padding: 3px; border: 1px solid #cbd5e1; }
</style>

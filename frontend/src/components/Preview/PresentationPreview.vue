<script setup lang="ts">
import {
  ElCard,
  ElEmpty
} from 'element-plus';
import {
  NText
} from '@/ui/element-plus-primitives';
import { ref } from 'vue';
import { getPresentationAnchorFromSelection } from '../../chat/previewSelection';
import type { PresentationAnchor } from '../../chat/fileReferences';
import type { PresentationSlidePreview } from '../../workspace/previewKind';
const props = defineProps<{
  slides: PresentationSlidePreview[];
  onSelectionChange?: (anchor: PresentationAnchor | null) => void;
}>();
const rootRef = ref<HTMLDivElement | null>(null);
const handleMouseUp = () => {
  if (!rootRef.value || !props.onSelectionChange) return;
  const anchor = getPresentationAnchorFromSelection(rootRef.value);
  props.onSelectionChange(anchor);
};
</script>
<template>
  <ElEmpty v-if="!slides.length" description="演示文稿无幻灯片" />
  <div
    v-else
    ref="rootRef"
    class="office-preview presentation-preview selectable-preview"
    @mouseup="handleMouseUp"
  >
    <ElCard
      v-for="slide in slides"
      :key="slide.index"
      class="presentation-slide-card"
      :title="`幻灯片 ${slide.index}`"
    >
      <ul v-if="slide.texts.length" class="presentation-slide-texts">
        <li v-for="(text, i) in slide.texts" :key="`${slide.index}-${i}`">
          {{ text }}
        </li>
      </ul>
      <NText v-else depth="3">（无文本内容）</NText>
    </ElCard>
  </div>
</template>

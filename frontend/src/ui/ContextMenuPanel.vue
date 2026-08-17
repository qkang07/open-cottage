<script setup lang="ts">
import { defineComponent, onMounted, onUnmounted, ref, type PropType, type VNodeChild } from 'vue';
import type { DropdownOption } from './element-plus-types';

const RenderFn = defineComponent({
  props: {
    render: { type: Function as PropType<() => VNodeChild>, required: true },
  },
  setup(props) {
    return () => props.render();
  },
});

const props = defineProps<{
  show: boolean;
  x: number;
  y: number;
  options: DropdownOption[];
  className?: string;
}>();

const emit = defineEmits<{
  select: [key: string | number];
  clickoutside: [event: MouseEvent];
  'update:show': [value: boolean];
}>();

const panelRef = ref<HTMLElement | null>(null);

const closeMenu = (event: MouseEvent) => {
  emit('clickoutside', event);
  emit('update:show', false);
};

const onDocumentMouseDown = (event: MouseEvent) => {
  if (!props.show) return;
  const panel = panelRef.value;
  const target = event.target as Node | null;
  if (panel && target && !panel.contains(target)) {
    closeMenu(event);
  }
};

onMounted(() => {
  document.addEventListener('mousedown', onDocumentMouseDown);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentMouseDown);
});

function handleOptionClick(option: DropdownOption) {
  if (option.disabled || option.type === 'group' || option.type === 'divider') return;
  const onClick = option.props?.onClick as undefined | (() => void);
  onClick?.();
  emit('select', option.key);
  emit('update:show', false);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      ref="panelRef"
      :class="['n-dropdown-menu', className]"
      :style="{ position: 'fixed', left: `${x}px`, top: `${y}px`, zIndex: 2100 }"
    >
      <template v-for="option in options" :key="String(option.key)">
        <div v-if="option.type === 'divider'" class="n-dropdown-divider" />
        <template v-else-if="option.type === 'group'">
          <div class="n-dropdown-group-header">{{ option.label }}</div>
          <button
            v-for="child in option.children ?? []"
            :key="String(child.key)"
            type="button"
            class="n-dropdown-option"
            :disabled="child.disabled"
            @click="handleOptionClick(child)"
          >
            <span v-if="child.icon" class="n-dropdown-option-icon">
              <RenderFn :render="child.icon" />
            </span>
            <span class="n-dropdown-option-body">
              <RenderFn
                v-if="typeof child.label === 'function'"
                :render="child.label"
              />
              <template v-else>{{ child.label ?? '' }}</template>
            </span>
          </button>
        </template>
        <button
          v-else
          type="button"
          class="n-dropdown-option"
          :disabled="option.disabled"
          @click="handleOptionClick(option)"
        >
          <span v-if="option.icon" class="n-dropdown-option-icon">
            <RenderFn :render="option.icon" />
          </span>
          <span class="n-dropdown-option-body">
            <RenderFn
              v-if="typeof option.label === 'function'"
              :render="option.label"
            />
            <template v-else>{{ option.label ?? '' }}</template>
          </span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

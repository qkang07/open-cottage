<script setup lang="ts">
import { ElOption, ElOptionGroup, ElSelect } from 'element-plus';
import type { SelectOption } from './element-plus-types';

const model = defineModel<string | number | null | undefined>();

defineProps<{
  options?: SelectOption[];
  filterable?: boolean;
  allowCreate?: boolean;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  selectStyle?: string | Record<string, string | number>;
}>();

const emit = defineEmits<{
  change: [value: string | number | null | undefined];
}>();
</script>

<template>
  <ElSelect
    v-model="model"
    :filterable="filterable"
    :allow-create="allowCreate"
    :default-first-option="allowCreate"
    :placeholder="placeholder"
    :disabled="disabled"
    :clearable="clearable"
    :style="selectStyle ?? { width: '100%' }"
    @change="emit('change', $event)"
  >
    <template v-for="opt in options ?? []" :key="String(opt.key ?? opt.value ?? opt.label)">
      <ElOptionGroup v-if="opt.type === 'group'" :label="String(opt.label)">
        <ElOption
          v-for="child in opt.children ?? []"
          :key="String(child.value)"
          :label="child.label"
          :value="child.value!"
        />
      </ElOptionGroup>
      <ElOption
        v-else-if="opt.value !== undefined"
        :key="String(opt.value)"
        :label="opt.label"
        :value="opt.value"
      />
    </template>
  </ElSelect>
</template>

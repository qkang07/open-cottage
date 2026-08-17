<template>
  <figure class="oc-shot" :data-label="label">
    <div class="oc-shot__frame">
      <div class="oc-shot__inner">
        <span class="oc-shot__badge">截图待补</span>
        <p class="oc-shot__title">{{ title }}</p>
        <p v-if="hint" class="oc-shot__hint">{{ hint }}</p>
        <p class="oc-shot__path">建议路径：<code>{{ path }}</code></p>
      </div>
    </div>
    <figcaption v-if="caption" class="oc-shot__caption">{{ caption }}</figcaption>
  </figure>
</template>

<script setup lang="ts">
defineProps<{
  /** 展示标题，描述画面内容 */
  title: string
  /** 建议存放的相对路径，如 images/main-ui.png */
  path: string
  /** 可选补充说明 */
  hint?: string
  /** 图注 */
  caption?: string
  /** 短标签 */
  label?: string
}>()
</script>

<style scoped>
.oc-shot {
  margin: 1.5rem 0 2rem;
}

.oc-shot__frame {
  border: 1px dashed var(--oc-line);
  border-radius: 14px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--cottage-accent) 8%, transparent),
      color-mix(in srgb, var(--cottage-gold) 8%, transparent)
    ),
    repeating-linear-gradient(
      -12deg,
      transparent,
      transparent 10px,
      color-mix(in srgb, var(--cottage-accent) 4%, transparent) 10px,
      color-mix(in srgb, var(--cottage-accent) 4%, transparent) 11px
    );
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 20px;
}

.oc-shot__inner {
  text-align: center;
  max-width: 28rem;
}

.oc-shot__badge {
  display: inline-block;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--oc-accent);
  border: 1px solid color-mix(in srgb, var(--oc-accent) 35%, transparent);
  padding: 3px 10px;
  border-radius: 4px;
  margin-bottom: 12px;
  font-weight: 600;
}

.oc-shot__title {
  margin: 0 0 8px;
  font-size: 1.05rem;
  font-weight: 650;
  color: var(--vp-c-text-1);
  line-height: 1.4;
}

.oc-shot__hint,
.oc-shot__path {
  margin: 0;
  font-size: 0.88rem;
  color: var(--vp-c-text-2);
  line-height: 1.55;
}

.oc-shot__path {
  margin-top: 10px;
}

.oc-shot__path code {
  font-size: 0.82rem;
}

.oc-shot__caption {
  margin-top: 10px;
  font-size: 0.86rem;
  color: var(--vp-c-text-3);
  text-align: center;
}
</style>

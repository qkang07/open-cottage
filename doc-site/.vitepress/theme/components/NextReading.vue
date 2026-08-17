<template>
  <section class="oc-next-reading">
    <p class="oc-next-reading__label">读到这里，你已经可以</p>
    <p class="oc-next-reading__body"><slot /></p>
    <a class="oc-next-reading__link" :href="to">{{ title }} <span aria-hidden="true">→</span></a>
  </section>
</template>

<script setup lang="ts">
defineProps<{ to: string; title: string }>()
</script>

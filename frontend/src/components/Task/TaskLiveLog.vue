<script setup lang="ts">
import {
  NText
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useAgentStore } from '../../stores/agent';
import MessageView from '../Chat/MessageView.vue';
const agentStore = useAgentStore();
const { chat } = storeToRefs(agentStore);
const bottomRef = ref<HTMLDivElement | null>(null);
const sectionVersion = computed(() => chat.value?.viewState.sectionVersion ?? 0);
const messagesView = computed(() => chat.value?.viewState.messages ?? []);
const messageCount = computed(() => messagesView.value.length);
watch(messageCount, () => {
  bottomRef.value?.scrollIntoView({ behavior: 'smooth' });
});
watch(sectionVersion, () => {
  if (!chat.value?.busy) return;
  bottomRef.value?.scrollIntoView({ behavior: 'auto', block: 'end' });
});
</script>
<template>
  <NText v-if="!chat" depth="3">正在连接任务会话…</NText>
  <NText v-else-if="!chat.messages.length" depth="3">等待 Agent 开始执行…</NText>
  <div v-else class="task-live-log">
    <MessageView
      v-for="(message, index) in messagesView"
      :key="message.id"
      :message="message"
      :live="chat.busy ? index === messagesView.length - 1 : false"
      :version="chat.busy ? sectionVersion : 0"
      :session-id="chat.getSessionId()"
    />
    <div ref="bottomRef" />
  </div>
</template>

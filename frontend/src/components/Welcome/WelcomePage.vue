<script setup lang="ts">
import {
  ArrowForward,
  BrowsersOutline,
  ChatbubbleOutline,
  DocumentTextOutline,
  FolderOpenOutline,
  LogoGithub,
  MoonOutline,
  ReaderOutline,
  SettingsOutline,
  SunnyOutline,
    } from '@vicons/ionicons5';
import { ElButton } from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useThemeStore } from '../../stores/theme';
import { useWorkspaceStore } from '../../stores/workspace';
import { officialLinks } from '../../config/officialLinks';
const emit = defineEmits<{
  openSettings: [];
}>();
const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const themeStore = useThemeStore();
const { recentWorkspaces, loading } = storeToRefs(workspaceStore);
const { isDark } = storeToRefs(themeStore);
const displayWorkspaceName = (item: { alias?: string; name: string }) =>
  item.alias?.trim() || item.name;
const formatRelativeTime = (timestamp: number) => {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return t('time.justNow');
  if (diff < hour) return t('time.minutesAgo', { n: Math.floor(diff / minute) });
  if (diff < day) return t('time.hoursAgo', { n: Math.floor(diff / hour) });
  if (diff < 7 * day) return t('time.daysAgo', { n: Math.floor(diff / day) });
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
};
const steps = computed(() => [
  {
    icon: FolderOpenOutline,
    title: t('welcome.stepOpenTitle'),
    description: t('welcome.stepOpenDesc'),
  },
  {
    icon: ReaderOutline,
    title: t('welcome.stepBrowseTitle'),
    description: t('welcome.stepBrowseDesc'),
  },
  {
    icon: ChatbubbleOutline,
    title: t('welcome.stepChatTitle'),
    description: t('welcome.stepChatDesc'),
  },
]);
</script>
<template>
  <div class="welcome-page">
    <div class="welcome-topbar">
      <CottageTooltip :content="t('welcome.docs')" placement="top">
        <a
          class="welcome-topbar-link"
          :href="officialLinks.docs"
          target="_blank"
          rel="noreferrer"
          :aria-label="t('welcome.docs')"
        >
          <NIcon :component="DocumentTextOutline" />
        </a>
      </CottageTooltip>
      <CottageTooltip content="GitHub" placement="top">
        <a
          class="welcome-topbar-link"
          :href="officialLinks.source"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
        >
          <NIcon :component="LogoGithub" />
        </a>
      </CottageTooltip>
      <CottageTooltip
        :content="isDark ? t('theme.toLight') : t('theme.toDark')"
        placement="top"
      >
        <ElButton
          text
          @click="themeStore.toggle()"
        >
          <template #icon>
            <NIcon :component="isDark ? SunnyOutline : MoonOutline" />
          </template>
        </ElButton>
      </CottageTooltip>
      <ElButton text @click="emit('openSettings')">
        <template #icon>
          <NIcon :component="SettingsOutline" />
        </template>
        {{ t('common.settings') }}
      </ElButton>
    </div>
    <header class="welcome-hero">
      <span class="welcome-logo-wrapper">
        <img
          :src="isDark ? '/logo-dark.svg' : '/logo-light.svg'"
          alt="Open Cottage"
          class="welcome-logo"
        />
      </span>
      <h1 class="welcome-title">Open Cottage</h1>
      <p class="welcome-slogan">{{ t('welcome.slogan') }}</p>
      <p class="welcome-subtitle">
        {{ t('welcome.subtitle') }}
      </p>
      <div class="welcome-flow" :aria-label="t('welcome.flowLabel')">
        <div class="welcome-flow-step">
          <span class="welcome-flow-icon">
            <NIcon :component="BrowsersOutline" :size="20" />
          </span>
          <span class="welcome-flow-copy">
            <strong>{{ t('welcome.flowBrowserTitle') }}</strong>
            <small>{{ t('welcome.flowBrowserDesc') }}</small>
          </span>
        </div>
        <NIcon :component="ArrowForward" class="welcome-flow-arrow" :size="18" />
        <div class="welcome-flow-step">
          <span class="welcome-flow-icon">
            <NIcon :component="FolderOpenOutline" :size="20" />
          </span>
          <span class="welcome-flow-copy">
            <strong>{{ t('welcome.flowWorkspaceTitle') }}</strong>
            <small>{{ t('welcome.flowWorkspaceDesc') }}</small>
          </span>
        </div>
        <NIcon :component="ArrowForward" class="welcome-flow-arrow" :size="18" />
        <div class="welcome-flow-step">
          <span class="welcome-flow-icon">
            <NIcon :component="DocumentTextOutline" :size="20" />
          </span>
          <span class="welcome-flow-copy">
            <strong>{{ t('welcome.flowDeliveryTitle') }}</strong>
            <small>{{ t('welcome.flowDeliveryDesc') }}</small>
          </span>
        </div>
      </div>
      <ElButton
        type="primary"
        size="large"
        class="welcome-cta"
        :loading="loading"
        @click="workspaceStore.openWorkspace()"
      >
        <template #icon>
          <NIcon :component="FolderOpenOutline" />
        </template>
        {{ t('welcome.openFolder') }}
      </ElButton>
      <!-- <p class="welcome-privacy">{{ t('welcome.privacy') }}</p> -->
    </header>
    <section v-if="recentWorkspaces.length > 0" class="welcome-section">
      <span class="welcome-section-title">{{ t('welcome.recent') }}</span>
      <div class="welcome-recent-list">
        <button
          v-for="item in recentWorkspaces"
          :key="item.id"
          type="button"
          class="welcome-recent-row"
          @click="workspaceStore.openRecentWorkspace(item.id)"
        >
          <span class="welcome-recent-icon">
            <NIcon :component="FolderOpenOutline" :size="16" />
          </span>
          <span class="welcome-recent-text">
            <CottageTooltip :content="displayWorkspaceName(item)" placement="top" delay="lazy">
              <span class="welcome-recent-name">
                {{ displayWorkspaceName(item) }}
              </span>
            </CottageTooltip>
            <CottageTooltip :content="item.path" placement="top" delay="lazy">
              <span class="welcome-recent-path">{{ item.path }}</span>
            </CottageTooltip>
          </span>
          <span class="welcome-recent-time">
            {{ formatRelativeTime(item.lastOpenedAt) }}
          </span>
          <NIcon :component="ArrowForward" class="welcome-recent-arrow" :size="14" />
        </button>
      </div>
    </section>
    <section class="welcome-section">
      <span class="welcome-section-title">{{ t('welcome.quickStart') }}</span>
      <ol class="welcome-steps">
        <li v-for="(step, index) in steps" :key="step.title" class="welcome-step">
          <span class="welcome-step-num">{{ index + 1 }}</span>
          <span class="welcome-step-text">
            <span class="welcome-step-title">
              <span class="welcome-step-icon">
                <NIcon :component="step.icon" :size="14" />
              </span>
              {{ step.title }}
            </span>
            <span class="welcome-step-desc">{{ step.description }}</span>
          </span>
        </li>
      </ol>
    </section>
  </div>
</template>

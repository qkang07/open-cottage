import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

/** 主题模式：亮色或暗色 */
export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'cottage-theme';

/** 从 localStorage 或系统偏好读取初始主题 */
function readInitialTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage 不可用时忽略
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** 将主题应用到 document 根元素 */
function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.setAttribute('data-theme', mode);
  root.style.colorScheme = mode;
}

// 模块加载时立即应用，避免首屏闪烁
const initialTheme = readInitialTheme();
applyTheme(initialTheme);

/**
 * 主题状态管理。
 * 控制应用主题模式，同步到 document 根元素和 localStorage。
 */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(initialTheme);
  const isDark = computed(() => mode.value === 'dark');

  watch(mode, (value) => {
    applyTheme(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // 持久化失败时忽略
    }
  });

  /** 设置主题模式 */
  function setMode(value: ThemeMode) {
    mode.value = value;
  }

  /** 切换主题模式 */
  function toggle() {
    mode.value = mode.value === 'dark' ? 'light' : 'dark';
  }

  return { mode, isDark, setMode, toggle };
});

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import en from 'element-plus/es/locale/lang/en';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import type { Language } from 'element-plus/es/locale';
import {
  DEFAULT_LOCALE,
  isAppLocale,
  setI18nLocale,
  type AppLocale,
} from '../i18n';

const STORAGE_KEY = 'cottage-locale';

/** 检测浏览器语言偏好，返回支持的应用语言 */
function detectBrowserLocale(): AppLocale {
  try {
    const langs = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const lang of langs) {
      const lower = lang.toLowerCase();
      if (lower.startsWith('zh')) return 'zh-CN';
      if (lower.startsWith('en')) return 'en-US';
    }
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE;
}

/** 从 localStorage 或浏览器偏好读取初始语言 */
function readInitialLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isAppLocale(stored)) return stored;
  } catch {
    // ignore
  }
  return detectBrowserLocale();
}

const initialLocale = readInitialLocale();
setI18nLocale(initialLocale);

/** Element Plus 语言包映射表 */
const ELEMENT_LOCALES: Record<AppLocale, Language> = {
  'zh-CN': zhCn,
  'en-US': en,
};

/**
 * 语言状态管理。
 * 控制应用语言，同步到 vue-i18n、Element Plus 和 localStorage。
 */
export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<AppLocale>(initialLocale);
  const elementLocale = computed(() => ELEMENT_LOCALES[locale.value]);

  watch(
    locale,
    (value) => {
      setI18nLocale(value);
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        // ignore
      }
    },
    { immediate: true },
  );

  /** 设置应用语言 */
  function setLocale(value: AppLocale) {
    locale.value = value;
  }

  return { locale, elementLocale, setLocale };
});

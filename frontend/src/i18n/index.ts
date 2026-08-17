import { createI18n } from 'vue-i18n';
import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';

export type AppLocale = 'zh-CN' | 'en-US';
export type MessageSchema = typeof zhCN;

export const LOCALE_OPTIONS: Array<{ value: AppLocale; labelKey: string }> = [
  { value: 'zh-CN', labelKey: 'locale.zhCN' },
  { value: 'en-US', labelKey: 'locale.enUS' },
];

export const DEFAULT_LOCALE: AppLocale = 'zh-CN';

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === 'zh-CN' || value === 'en-US';
}

export const i18n = createI18n<[MessageSchema], AppLocale, false>({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
});

export function setI18nLocale(locale: AppLocale) {
  i18n.global.locale.value = locale;
  document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en';
}

export default i18n;

import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { watch } from 'vue';
import { loader } from '@guolao/vue-monaco-editor';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import highlightDarkCssUrl from 'highlight.js/styles/github-dark.css?url';
import highlightLightCssUrl from 'highlight.js/styles/github.css?url';
import hljs from 'highlight.js';
import { config as configMdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/preview.css';
import App from './App.vue';
import './index.css';
import i18n from './i18n';
import { useThemeStore } from './stores/theme';
import { loadLayeredCottageConfig } from './config/cottageStorage';
import { useCottageServiceStore } from './stores/cottageService';
import { useLocaleStore } from './stores/locale';

loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs',
  },
});

// 让 md-editor-v3 使用本地打包的 highlight.js 实例与 github 代码主题，
// 避免默认从 CDN 加载，保证离线可用且与其它代码高亮风格一致。
configMdPreview({
  editorExtensions: {
    highlight: {
      instance: hljs,
      css: {
        github: {
          light: highlightLightCssUrl,
          dark: highlightDarkCssUrl,
        },
      },
    },
  },
});

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(i18n);
app.use(ElementPlus);
// 初始化 locale store，同步 html lang / Element 语言
useLocaleStore(pinia);
const highlightThemeLinkId = 'cottage-highlight-theme';
function applyHighlightTheme(dark: boolean) {
  const href = dark ? highlightDarkCssUrl : highlightLightCssUrl;
  let link = document.getElementById(highlightThemeLinkId) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = highlightThemeLinkId;
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.href !== href) {
    link.href = href;
  }
}
const themeStore = useThemeStore(pinia);
applyHighlightTheme(themeStore.isDark);
watch(
  () => themeStore.isDark,
  (dark) => applyHighlightTheme(dark),
);
// 启动时加载配置并恢复 Cottage Service 连接（须在 Agent 挂载前完成）
void (async () => {
  await loadLayeredCottageConfig();
  await useCottageServiceStore(pinia).restore();
  app.mount('#app');
})();

import basicSsl from '@vitejs/plugin-basic-ssl';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import { fileURLToPath } from 'node:url';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

// web-tree-sitter 胶水代码引用了 Node 内置模块，浏览器端不存在，
// 统一映射到空 stub 避免 Vite 外化警告与运行时 require 报错。
const nodeStub = fileURLToPath(new URL('./src/util/nodeStub.ts', import.meta.url));

const publicStub = (name: string) =>
  fileURLToPath(new URL(`./src/build/public-stubs/${name}`, import.meta.url));

/**
 * public 构建将隐藏功能入口解析到空实现，确保实现模块不会进入 Rollup 模块图。
 * serve 与 `--mode full` 保留完整实现，便于开发和未来恢复功能。
 */
const publicBuildFeatureStubs = (): Plugin => {
  const suffixStubs: Array<[RegExp, string]> = [
    [/\/platform\/packs\/builtins\/dataAnalysis$/, publicStub('dataAnalysisPack.ts')],
    [/\/platform\/plan$/, publicStub('plan.ts')],
    [/\/stores\/task$/, publicStub('taskStore.ts')],
    [/\/task\/taskSignals$/, publicStub('taskSignals.ts')],
    [/\/task\/subtask$/, publicStub('subtask.ts')],
    [/\/task\/persistence$/, publicStub('taskPersistence.ts')],
    [/\/orchestrator\/Orchestrator$/, publicStub('orchestrator.ts')],
    [/\/orchestrator\/persistence$/, publicStub('orchestrationPersistence.ts')],
    [/\/Orchestrator\/OrchestrationCard\.vue$/, publicStub('HiddenFeatureStub.vue')],
    [/\/rag\/indexer$/, publicStub('ragIndexer.ts')],
    [/\/rag\/indexBackground$/, publicStub('ragIndexBackground.ts')],
    [/\/rag\/indexWorkerHost$/, publicStub('ragIndexWorkerHost.ts')],
    [/\/rag\/wasm\/cosineKernel$/, publicStub('ragCosineKernel.ts')],
    [/\/rag$/, publicStub('rag.ts')],
  ];

  const hiddenImplementationReason = (id: string): string | null => {
    const normalized = id.replace(/\\/g, '/').split('?', 1)[0];
    if (normalized.includes('/node_modules/@huggingface/transformers/')) {
      return '本地 RAG 的 Transformers 运行时';
    }
    if (
      normalized.includes('/src/rag/') &&
      !normalized.endsWith('/src/rag/indexWorkspace.ts') &&
      !normalized.endsWith('/src/rag/indexProgressSteps.ts') &&
      !normalized.endsWith('/src/rag/types.ts')
    ) {
      return '本地 RAG 实现';
    }
    if (
      normalized.includes('/src/task/') &&
      !normalized.endsWith('/src/task/types.ts')
    ) {
      return '任务模式实现';
    }
    if (
      normalized.includes('/src/orchestrator/') &&
      !normalized.endsWith('/src/orchestrator/types.ts')
    ) {
      return '编排模式实现';
    }
    if (
      normalized.includes('/src/platform/plan/') &&
      !normalized.endsWith('/src/platform/plan/types.ts')
    ) {
      return 'Plan Gate 实现';
    }
    if (
      normalized.endsWith('/src/platform/packs/builtins/dataAnalysis.ts') ||
      normalized.endsWith('/src/agent/pythonCottageTool.ts') ||
      normalized.endsWith('/src/agent/runPython.ts') ||
      normalized.endsWith('/src/agent/pyodide.worker.ts')
    ) {
      return 'Python 数据分析实现';
    }
    if (
      normalized.includes('/src/components/Task/') ||
      normalized.includes('/src/components/Orchestrator/')
    ) {
      return '隐藏功能 UI';
    }
    return null;
  };

  return {
    name: 'cottage-public-build-feature-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
      const normalizedSource = source.replace(/\\/g, '/');
      const normalizedImporter = importer?.replace(/\\/g, '/');

      // stores/agent.ts 内的相对动态导入 `./task` 无法仅靠后缀区分。
      if (
        normalizedSource === './task' &&
        normalizedImporter?.endsWith('/stores/agent.ts')
      ) {
        return publicStub('taskStore.ts');
      }

      if (
        normalizedSource === './dataAnalysis' &&
        normalizedImporter?.endsWith('/platform/packs/builtins/index.ts')
      ) {
        return publicStub('dataAnalysisPack.ts');
      }

      for (const [pattern, replacement] of suffixStubs) {
        if (pattern.test(normalizedSource)) return replacement;
      }
      return null;
    },
    moduleParsed(info) {
      const reason = hiddenImplementationReason(info.id);
      if (reason) {
        const importers = [...info.importers, ...info.dynamicImporters].map(
          (id) => id.replace(/\\/g, '/'),
        );
        this.error(
          `public 构建检测到不应打包的${reason}：${info.id}` +
            (importers.length > 0 ? `\n导入来源：${importers.join(', ')}` : ''),
        );
      }
    },
  };
};

export default defineConfig(({ command, mode }): UserConfig => {
  const includeHiddenFeatures = command === 'serve' || mode === 'full';
  const analyzeBundle = mode === 'analyze';

  return {
  plugins: [
    ...(includeHiddenFeatures ? [] : [publicBuildFeatureStubs()]),
    vue(),
    basicSsl(),
    AutoImport({
      imports: ['vue', 'pinia', 'vue-i18n'],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts',
    }),
    ...(analyzeBundle
      ? [
        visualizer({
          filename: 'dist/bundle-analyze.html',
          template: 'treemap',
          gzipSize: true,
          brotliSize: true,
          open: false,
        }),
      ]
      : []),
  ],
  resolve: {
    alias: {
      '@': '/src',
      // web-tree-sitter 胶水代码引用了 Node 内置模块，浏览器端不存在，
      // 将其映射为空模块避免 Vite 外化警告与运行时 require 报错。
      'fs/promises': nodeStub,
      'fs': nodeStub,
      'path': nodeStub,
    },
  },
  define: {
    __COTTAGE_INCLUDE_HIDDEN_FEATURES__: JSON.stringify(includeHiddenFeatures),
  },
  optimizeDeps: {
    // 预构建 web-tree-sitter，避免动态 import 时触发 Node 模块外化警告
    include: ['web-tree-sitter'],
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // web-tree-sitter 内部使用 eval 做 WASM 实例化，属于 Emscripten 产物固有行为，
        // 安全可控（仅加载受信语法包），在此屏蔽 Rollup 的 eval 警告。
        if (
          warning.code === 'EVAL' &&
          warning.id?.includes('web-tree-sitter')
        ) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'pinia', 'vue-i18n'],
          'element-plus': ['element-plus'],
          'ai-sdk': ['ai', '@ai-sdk/openai', '@ai-sdk/openai-compatible', '@ai-sdk/anthropic', '@ai-sdk/google', 'zod', 'zod-to-json-schema'],
          'highlight': ['highlight.js'],
          'markdown': ['markdown-it', 'md-editor-v3'],
        },
      },
    },
  },
  // AST / Diff 等 Worker 含动态 import，IIFE 不支持 code-splitting
  worker: {
    format: 'es',
  },
  server: {
    port: 5176,
    https: {},
    host: 'cottage.local',
    allowedHosts: ['cottage.local','cyhome.swimlions.cn','localhost','127.0.0.1'],
    // hmr: {
    //   // host: 'cyhome.swimlions.cn',
    //   host: 'cottage.local',
    //   protocol: 'ws',
    //   clientPort: 18080, // 若前面有 Nginx 转到 80，这里改成 80
    // },
    // proxy: {
    //   '/api/llm': {
    //     target: 'http://localhost:3111',
    //     changeOrigin: true,
    //     rewrite: (path) => path.replace(/^\/api\/llm/, ''),
    //   },
    // },
  },
  };
});

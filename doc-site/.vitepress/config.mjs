import { siteLinks } from './site-links.mjs'

const githubIcon = {
  svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.02 3.25 9.27 7.76 10.78.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.16.69-3.83-1.34-3.83-1.34-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.52-2.52-.29-5.17-1.26-5.17-5.6 0-1.24.44-2.25 1.17-3.05-.12-.29-.51-1.44.11-3 0 0 .95-.3 3.12 1.17A10.85 10.85 0 0 1 12 6.8c.97 0 1.95.13 2.86.39 2.18-1.47 3.12-1.17 3.12-1.17.62 1.56.23 2.71.11 3 .73.8 1.17 1.81 1.17 3.05 0 4.35-2.65 5.31-5.18 5.6.41.35.77 1.01.77 2.04 0 1.47-.01 2.66-.01 3.02 0 .3.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z"/></svg>',
}

const guideSidebar = [
  {
    text: '快速上手',
    items: [
      { text: 'Open Cottage 是什么', link: '/guide/introduction' },
      { text: '五分钟配置', link: '/guide/first-setup' },
      { text: '认识主界面', link: '/guide/ui' },
    ],
  },
  {
    text: '日常怎么用',
    items: [
      { text: '和 Agent 对话', link: '/guide/chat' },
      { text: '计划模式做复杂任务', link: '/guide/spec' },
      { text: '审阅与批准改动', link: '/guide/governance' },
      { text: '预览、引用与附件', link: '/guide/preview' },
      { text: '工作区与数据在哪', link: '/guide/workspace' },
      { text: '版本历史 Beta', link: '/guide/history' },
    ],
  },
  {
    text: '设置与安全',
    items: [
      { text: '设置界面', link: '/guide/settings' },
      { text: '模型提供商与 Key', link: '/guide/models-and-keys' },
      { text: '安全说明', link: '/guide/security' },
    ],
  },
]

const englishGuideSidebar = [
  {
    text: 'Get started',
    items: [
      { text: 'What is Open Cottage?', link: '/en/guide/introduction' },
      { text: 'Five-minute setup', link: '/en/guide/first-setup' },
      { text: 'The main interface', link: '/en/guide/ui' },
    ],
  },
  {
    text: 'Everyday work',
    items: [
      { text: 'Chat with the Agent', link: '/en/guide/chat' },
      { text: 'Plan complex work', link: '/en/guide/spec' },
      { text: 'Review and approve changes', link: '/en/guide/governance' },
      { text: 'Previews, references, and attachments', link: '/en/guide/preview' },
      { text: 'Workspaces and local data', link: '/en/guide/workspace' },
      { text: 'Version History Beta', link: '/en/guide/history' },
    ],
  },
  {
    text: 'Settings and safety',
    items: [
      { text: 'Settings', link: '/en/guide/settings' },
      { text: 'Model providers and API keys', link: '/en/guide/models-and-keys' },
      { text: 'Security', link: '/en/guide/security' },
    ],
  },
]

const englishThemeConfig = {
  langMenuLabel: 'Change language',
  outline: { label: 'On this page', level: [2, 3] },
  search: {
    provider: 'local',
    options: {
      locales: {
        en: {
          translations: {
            button: { buttonText: 'Search', buttonAriaLabel: 'Search documentation' },
            modal: {
              noResultsText: 'No results found',
              resetButtonTitle: 'Clear query',
              footer: { selectText: 'Select', navigateText: 'Navigate', closeText: 'Close' },
            },
          },
        },
      },
    },
  },
  lastUpdated: { text: 'Last updated', formatOptions: { dateStyle: 'medium', timeStyle: 'short' } },
  docFooter: { prev: 'Previous page', next: 'Next page' },
  returnToTopLabel: 'Back to top',
  sidebarMenuLabel: 'Menu',
  darkModeSwitchLabel: 'Theme',
  lightModeSwitchTitle: 'Switch to light theme',
  darkModeSwitchTitle: 'Switch to dark theme',
  socialLinks: siteLinks.source
    ? [{ icon: githubIcon, link: siteLinks.source, ariaLabel: 'GitHub' }]
    : [],
  nav: [
    { text: 'Home', link: '/en/' },
    { text: 'Get started', link: '/en/guide/introduction', activeMatch: '/en/guide/' },
    { text: 'Concepts', link: '/en/concepts/', activeMatch: '/en/concepts/' },
    ...(siteLinks.demo ? [{ text: 'Live demo', link: siteLinks.demo, target: '_blank' }] : []),
    {
      text: 'By task',
      items: [
        { text: 'Documents, slides, and spreadsheets', link: '/en/guide/use-office' },
        { text: 'Code changes', link: '/en/guide/use-coding' },
        { text: 'Research', link: '/en/guide/use-research' },
        { text: 'Web fetching and automation', link: '/en/guide/use-web' },
        { text: 'PDFs and charts', link: '/en/guide/use-pdf-chart' },
        { text: 'Plan mode', link: '/en/guide/spec' },
      ],
    },
    {
      text: 'Developers',
      items: [
        { text: 'Tool catalog', link: '/en/reference/tools' },
        { text: 'Architecture overview', link: '/en/architecture/overview' },
        { text: 'Author a Capability Pack', link: '/en/architecture/pack-authoring' },
        { text: 'Deploy Cottage Service', link: '/en/architecture/cottage-service-deploy' },
        { text: 'Contributing', link: '/en/architecture/contributing' },
      ],
    },
  ],
  sidebar: {
    '/en/concepts/': [
      {
        text: 'Understand Open Cottage',
        items: [
          { text: 'Concept index', link: '/en/concepts/' },
          { text: 'Workspaces', link: '/en/concepts/workspace' },
          { text: 'Your data stays local', link: '/en/concepts/local-data' },
          { text: 'Site and workspace settings', link: '/en/concepts/storage-layers' },
          { text: 'Models, presets, and API keys', link: '/en/concepts/models-and-keys' },
          { text: 'Capability packs', link: '/en/concepts/capability-packs' },
          { text: 'Skills', link: '/en/concepts/skills-concepts' },
          { text: 'Cottage Service', link: '/en/concepts/cottage-service-concepts' },
        ],
      },
      {
        text: 'Collaboration',
        items: [
          { text: 'Model and capability panel', link: '/en/concepts/model-capability-panel' },
          { text: 'File previews', link: '/en/concepts/file-preview' },
          { text: '@ references and attachments', link: '/en/concepts/mentions-and-attachments' },
          { text: 'Chats, plans, and sessions', link: '/en/concepts/chat-modes' },
          { text: 'Staged review and approval', link: '/en/concepts/governance-concepts' },
        ],
      },
    ],
    '/en/guide/': englishGuideSidebar,
    '/en/packs/': [{ text: 'Advanced capabilities', items: [
      { text: 'Code changes', link: '/en/packs/coding' },
      { text: 'Image generation', link: '/en/packs/imagegen' },
      { text: 'Workspace tidy-up', link: '/en/packs/tidy' },
      { text: 'Install external capabilities', link: '/en/packs/external' },
      { text: 'What are capability packs?', link: '/en/concepts/capability-packs' },
    ] }],
    '/en/reference': [{ text: 'Developer reference', items: [
      { text: 'Tool catalog', link: '/en/reference/tools' },
      { text: 'Cottage Service API', link: '/en/reference/cottage-service-api' },
    ] }],
    '/en/architecture/': [{ text: 'Develop Open Cottage', items: [
      { text: 'Local development', link: '/en/guide/install' },
      { text: 'Architecture overview', link: '/en/architecture/overview' },
      { text: 'Platform vision', link: '/en/architecture/vision' },
      { text: 'Author a Capability Pack', link: '/en/architecture/pack-authoring' },
      { text: 'Deploy Cottage Service', link: '/en/architecture/cottage-service-deploy' },
      { text: 'Contributing', link: '/en/architecture/contributing' },
    ] }],
  },
  footer: { message: 'Released under the MIT License.', copyright: 'Copyright © Open Cottage contributors' },
}

/** @type {import('vitepress').UserConfig} */
export default {
  lang: 'zh-CN',
  title: 'Open Cottage',
  description:
    '不是再做一个更会聊天的窗口：在你自己的环境里，把自然语言意图变成可核对、可审批、敢长期托付的结果。',
  cleanUrls: true,
  locales: {
    root: { label: '简体中文', lang: 'zh-CN', link: '/' },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'Open Cottage',
      description: 'A browser-first Agent for working safely in your local folders.',
      themeConfig: englishThemeConfig,
    },
  },
  // 内部维护说明，不作为文档站页面构建或暴露。
  srcExclude: [
    'architecture/experimental.md',
    'README.md',
    'public/images/README.md',
  ],
  lastUpdated: true,
  ignoreDeadLinks: true,

  head: [
    ['meta', { name: 'theme-color', content: '#607b66' }],
    [
      'link',
      { rel: 'icon', type: 'image/svg+xml', href: '/logo-light.svg' },
    ],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/logo-light.svg',
        media: '(prefers-color-scheme: light)',
      },
    ],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/logo-dark.svg',
        media: '(prefers-color-scheme: dark)',
      },
    ],
    [
      'meta',
      {
        name: 'og:title',
        content: 'Open Cottage — 在你自己的文件夹里把意图变成结果',
      },
    ],
    [
      'meta',
      {
        name: 'og:description',
        content:
          '聊天式 Agent 已经不难；难的是敢托付。Open Cottage 以本地文件夹为边界，把结果变成可预览、可 diff、可回滚的文件。',
      },
    ],
  ],

  themeConfig: {
    logo: {
      light: '/logo-light.svg',
      dark: '/logo-dark.svg',
    },
    siteTitle: 'Open Cottage',
    outline: { label: '本页目录', level: [2, 3] },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有结果',
            resetButtonTitle: '清除',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭',
            },
          },
        },
      },
    },
    lastUpdated: {
      text: '最后更新',
      formatOptions: { dateStyle: 'medium', timeStyle: 'short' },
    },
    docFooter: { prev: '上一页', next: '下一页' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    langMenuLabel: '切换语言',
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',
    socialLinks: siteLinks.source
      ? [{ icon: githubIcon, link: siteLinks.source, ariaLabel: 'GitHub' }]
      : [],

    nav: [
      { text: '首页', link: '/' },
      { text: '开始使用', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: '理解产品', link: '/concepts/', activeMatch: '/concepts/' },
      ...(siteLinks.demo
        ? [{ text: '官方 Demo', link: siteLinks.demo, target: '_blank' }]
        : []),
      {
        text: '按场景',
        items: [
          { text: '写文档 / PPT / 表格', link: '/guide/use-office' },
          { text: '改代码', link: '/guide/use-coding' },
          { text: '做调研', link: '/guide/use-research' },
          { text: '网页抓取与自动化', link: '/guide/use-web' },
          { text: 'PDF 与图表', link: '/guide/use-pdf-chart' },
          { text: '计划模式', link: '/guide/spec' },
        ],
      },
      {
        text: '开发者',
        items: [
          { text: '工具目录', link: '/reference/tools' },
          { text: '架构概览', link: '/architecture/overview' },
          { text: '编写 Capability Pack', link: '/architecture/pack-authoring' },
          { text: '部署服务', link: '/architecture/cottage-service-deploy' },
          { text: '贡献指南', link: '/architecture/contributing' },
        ],
      },
    ],

    sidebar: {
      '/concepts/': [
        {
          text: '理解 Open Cottage',
          items: [
            { text: '专题目录', link: '/concepts/' },
            { text: '工作区', link: '/concepts/workspace' },
            { text: '数据在本地', link: '/concepts/local-data' },
            { text: '两层配置：域名与工作区', link: '/concepts/storage-layers' },
            { text: '模型、预设与 API Key', link: '/concepts/models-and-keys' },
            { text: '能力包', link: '/concepts/capability-packs' },
            { text: 'Skills 技能', link: '/concepts/skills-concepts' },
            { text: 'Cottage Service', link: '/concepts/cottage-service-concepts' },
          ],
        },
        {
          text: '协作机制',
          items: [
            { text: '「模型与能力」面板', link: '/concepts/model-capability-panel' },
            { text: '文件预览', link: '/concepts/file-preview' },
            { text: '@ 引用与附件', link: '/concepts/mentions-and-attachments' },
            { text: '对话、计划与会话', link: '/concepts/chat-modes' },
            { text: '暂存审阅与审批', link: '/concepts/governance-concepts' },
          ],
        },
      ],
      '/guide/': guideSidebar,
      '/packs/': [
        {
          text: '进阶能力',
          items: [
            { text: '代码改造', link: '/packs/coding' },
            { text: '图片生成', link: '/packs/imagegen' },
            { text: '工作区整理', link: '/packs/tidy' },
            { text: '安装外部能力', link: '/packs/external' },
            { text: '专题：能力包是什么', link: '/concepts/capability-packs' },
          ],
        },
      ],
      // 页面匹配使用源文件相对路径；其余 reference 页面进入开发参考。
      '/reference': [
        {
          text: '开发参考',
          items: [
            { text: '工具目录', link: '/reference/tools' },
            {
              text: 'cottage-service API',
              link: '/reference/cottage-service-api',
            },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '开发 Open Cottage',
          items: [
            { text: '本地开发与启动', link: '/guide/install' },
            { text: '架构概览', link: '/architecture/overview' },
            { text: '平台愿景', link: '/architecture/vision' },
            {
              text: '编写 Capability Pack',
              link: '/architecture/pack-authoring',
            },
            {
              text: '部署 Cottage Service',
              link: '/architecture/cottage-service-deploy',
            },
            { text: '贡献指南', link: '/architecture/contributing' },
          ],
        },
      ],
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Open Cottage contributors',
    },
  },
}


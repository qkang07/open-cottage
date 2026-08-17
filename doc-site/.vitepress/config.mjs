import { siteLinks } from './site-links.mjs'

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

/** @type {import('vitepress').UserConfig} */
export default {
  lang: 'zh-CN',
  title: 'Open Cottage',
  description:
    '不是再做一个更会聊天的窗口：在你自己的环境里，把自然语言意图变成可核对、可审批、敢长期托付的结果。',
  cleanUrls: true,
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
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',

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
          ...(siteLinks.source
            ? [{ text: '开源仓库', link: siteLinks.source, target: '_blank' }]
            : []),
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
            { text: 'llm-proxy', link: '/reference/llm-proxy' },
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
            {
              text: '部署 llm-proxy',
              link: '/architecture/llm-proxy-deploy',
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


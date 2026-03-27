import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'AgentBoot',
  tagline: 'Convention over configuration for agentic development teams',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://agentboot.dev',
  baseUrl: '/',

  organizationName: 'agentboot-dev',
  projectName: 'agentboot',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/agentboot-dev/agentboot/tree/main/',
          // Exclude internal docs and planning files from the public site
          exclude: ['internal/**', 'install/**'],
        },
        blog: false, // Disable blog for now
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'AgentBoot',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/roadmap',
          label: 'Roadmap',
          position: 'left',
        },
        {
          href: 'https://github.com/agentboot-dev/agentboot',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started' },
            { label: 'Core Concepts', to: '/docs/concepts' },
            { label: 'CLI Reference', to: '/docs/cli-reference' },
          ],
        },
        {
          title: 'Guides',
          items: [
            { label: 'Extending AgentBoot', to: '/docs/extending' },
            { label: 'Prompt Authoring', to: '/docs/prompt-guide' },
            { label: 'Privacy & Safety', to: '/docs/privacy' },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/agentboot-dev/agentboot',
            },
            {
              label: 'Issues',
              href: 'https://github.com/agentboot-dev/agentboot/issues',
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} AgentBoot Contributors. Apache-2.0 License.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'toml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

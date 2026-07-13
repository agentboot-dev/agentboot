import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'AgentBoot',
  tagline: 'AI behavior as code.',
  favicon: 'img/favicon.png',

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

  // AEO / GEO / SEO: JSON-LD structured data so answer engines and agentic
  // workflows can parse what AgentBoot is and how to use it. See also
  // static/llms.txt (the agent/LLM index of the site).
  headTags: [
    {
      tagName: 'script',
      attributes: {type: 'application/ld+json'},
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'AgentBoot',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'macOS, Linux, Windows',
        description:
          'AgentBoot is the compiler for AI behavior as code: author your team’s ' +
          'personas, rules, and guardrails once in a hub repo, compile them to native ' +
          'config for Claude Code, OpenAI Codex CLI, and GitHub Copilot CLI, and ship ' +
          'them to every repo as a reviewable pull request — verified against drift.',
        url: 'https://agentboot.dev',
        codeRepository: 'https://github.com/agentboot-dev/agentboot',
        license: 'https://www.apache.org/licenses/LICENSE-2.0',
        offers: {'@type': 'Offer', price: '0', priceCurrency: 'USD'},
      }),
    },
    {
      tagName: 'link',
      attributes: {rel: 'alternate', type: 'text/plain', href: '/llms.txt', title: 'llms.txt'},
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/agentboot-dev/agentboot/tree/main/',
          // Exclude internal docs from the public site
          exclude: ['internal/**'],
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Default social-card / OG image + discovery metadata.
    image: 'img/logo.png',
    metadata: [
      {
        name: 'description',
        content:
          'Compile your team’s AI behavior once and ship it to every repo as a pull request. ' +
          'Native config for Claude Code, OpenAI Codex CLI, and GitHub Copilot CLI — self-hosted, ' +
          'verified against drift.',
      },
      {
        name: 'keywords',
        content:
          'AI behavior as code, AI agent governance, keep CLAUDE.md AGENTS.md in sync, ' +
          'AI coding assistant configuration, Claude Code hooks, Codex CLI, GitHub Copilot CLI, ' +
          'managed AI settings, persona compiler, drift detection',
      },
      {name: 'og:type', content: 'website'},
      {name: 'twitter:card', content: 'summary_large_image'},
    ],
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'AgentBoot',
      logo: {
        alt: 'AgentBoot Logo',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {to: '/why', label: 'Why AgentBoot', position: 'left'},
        {to: '/for-organizations', label: 'For Organizations', position: 'left'},
        {to: '/trust', label: 'Trust & Architecture', position: 'left'},
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
            {label: 'Getting Started', to: '/docs/getting-started'},
            {label: 'Core Concepts', to: '/docs/concepts'},
            {label: 'CLI Reference', to: '/docs/cli-reference'},
            {label: 'Import Existing Config', to: '/docs/import'},
            {label: 'Harness Templates', to: '/docs/templates'},
          ],
        },
        {
          title: 'For Organizations',
          items: [
            {label: 'Why AgentBoot', to: '/why'},
            {label: 'For Organizations', to: '/for-organizations'},
            {label: 'Trust & Architecture', to: '/trust'},
            {label: 'Platform Capability Matrix', to: '/docs/platform-capability-matrix'},
          ],
        },
        {
          title: 'Guides',
          items: [
            {label: 'Extending AgentBoot', to: '/docs/extending'},
            {label: 'Prompt Authoring', to: '/docs/prompt-guide'},
            {label: 'Privacy & Safety', to: '/docs/privacy'},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'GitHub', href: 'https://github.com/agentboot-dev/agentboot'},
            {label: 'Issues', href: 'https://github.com/agentboot-dev/agentboot/issues'},
            {label: 'Discussions', href: 'https://github.com/agentboot-dev/agentboot/discussions'},
            {label: 'Roadmap', to: '/docs/roadmap'},
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

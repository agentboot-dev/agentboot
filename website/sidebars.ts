import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started',
        'concepts',
        'configuration',
        'import',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'extending',
        'cli-reference',
        'prompt-guide',
        'model-selection',
        'templates',
      ],
    },
    {
      type: 'category',
      label: 'For Organizations',
      items: [
        'delivery-methods',
        'org-connection',
        'platform-capability-matrix',
        'hub-cicd',
        'privacy',
      ],
    },
    {
      type: 'category',
      label: 'Compare',
      items: [
        'vs-a-hand-rolled-settings-repo',
        'vs-per-tool-rules-files',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'glossary',
        'troubleshooting',
        'migration',
        'github-bot',
        'roadmap',
      ],
    },
  ],
};

export default sidebars;

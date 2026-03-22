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
      ],
    },
    {
      type: 'category',
      label: 'For Organizations',
      items: [
        'delivery-methods',
        'org-connection',
        'privacy',
      ],
    },
    {
      type: 'category',
      label: 'Community',
      items: [
        'marketplace',
        'roadmap',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'glossary',
        'troubleshooting',
      ],
    },
  ],
};

export default sidebars;

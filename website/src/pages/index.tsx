import React from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

function Hero() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header style={{
      padding: '4rem 2rem',
      textAlign: 'center',
      background: 'var(--ifm-background-surface-color)',
    }}>
      <h1 style={{fontSize: '3rem', marginBottom: '1rem'}}>
        {siteConfig.title}
      </h1>
      <p style={{fontSize: '1.4rem', color: 'var(--ifm-color-emphasis-700)', maxWidth: '640px', margin: '0 auto 2rem'}}>
        {siteConfig.tagline}
      </p>
      <div style={{display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap'}}>
        <Link
          className="button button--primary button--lg"
          to="/docs/getting-started">
          Get Started
        </Link>
        <Link
          className="button button--secondary button--lg"
          to="/docs/concepts">
          Core Concepts
        </Link>
        <Link
          className="button button--outline button--lg"
          href="https://github.com/agentboot-dev/agentboot">
          GitHub
        </Link>
      </div>
    </header>
  );
}

function Feature({title, description}: {title: string; description: string}) {
  return (
    <div style={{flex: '1 1 280px', padding: '1.5rem'}}>
      <h3>{title}</h3>
      <p style={{color: 'var(--ifm-color-emphasis-700)'}}>{description}</p>
    </div>
  );
}

function Features() {
  return (
    <section style={{padding: '3rem 2rem', maxWidth: '960px', margin: '0 auto'}}>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: '1rem'}}>
        <Feature
          title="Build Once, Deploy Everywhere"
          description="Compile AI agent personas from traits, instructions, and gotchas. Distribute to every repo in your org via a single build step."
        />
        <Feature
          title="Multi-Platform Output"
          description="Generate native output for Claude Code (.claude/), GitHub Copilot (.github/), and agentskills.io format. One source, all platforms."
        />
        <Feature
          title="Governance Without Friction"
          description="Scope hierarchy (org > group > team > repo) lets you enforce compliance centrally while teams customize locally."
        />
      </div>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '1rem'}}>
        <Feature
          title="Privacy by Design"
          description="Three-tier privacy model. Raw prompts never leave the developer's machine. Telemetry is anonymized and opt-in."
        />
        <Feature
          title="Plugin Distribution"
          description="Export personas as Claude Code plugins. Publish to private or public marketplaces. Install with one command."
        />
        <Feature
          title="Convention Over Configuration"
          description="Sensible defaults for everything. Edit one config file. Bootstrap your agentic development teams."
        />
      </div>
    </section>
  );
}

function QuickStart() {
  return (
    <section style={{
      padding: '3rem 2rem',
      background: 'var(--ifm-background-surface-color)',
      borderTop: '1px solid var(--ifm-color-emphasis-200)',
    }}>
      <div style={{maxWidth: '640px', margin: '0 auto'}}>
        <h2 style={{textAlign: 'center', marginBottom: '1.5rem'}}>Quick Start</h2>
        <pre style={{
          padding: '1.5rem',
          borderRadius: '8px',
          fontSize: '0.95rem',
          lineHeight: '1.6',
        }}>
{`npx agentboot setup        # scaffold config
agentboot build            # compile personas
agentboot sync             # distribute to repos`}
        </pre>
        <p style={{textAlign: 'center', marginTop: '1.5rem'}}>
          <Link to="/docs/getting-started">
            Full getting started guide &rarr;
          </Link>
        </p>
      </div>
    </section>
  );
}

export default function Home(): React.JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description={siteConfig.tagline}>
      <Hero />
      <Features />
      <QuickStart />
    </Layout>
  );
}

import React, { useState } from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: pkgVersion } = require('../../../package.json') as { version: string };

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg: '#0f172a',
  surface: '#1e293b',
  surfaceHover: '#263347',
  border: '#334155',
  borderSubtle: '#1e293b',
  primary: '#3b82f6',
  primaryHover: '#2563eb',
  primaryGlow: 'rgba(59, 130, 246, 0.15)',
  text: '#f8fafc',
  muted: '#94a3b8',
  green: '#10b981',
  greenGlow: 'rgba(16, 185, 129, 0.12)',
  amber: '#f59e0b',
  purple: '#8b5cf6',
};

// ─── Shared style helpers ─────────────────────────────────────────────────────
const sectionBase: React.CSSProperties = {
  width: '100%',
  padding: '5rem 1.5rem',
};

const containerStyle: React.CSSProperties = {
  maxWidth: '1100px',
  margin: '0 auto',
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '2rem',
  fontWeight: 700,
  color: C.text,
  textAlign: 'center',
  marginBottom: '0.75rem',
  letterSpacing: '-0.02em',
};

const sectionSubStyle: React.CSSProperties = {
  fontSize: '1.1rem',
  color: C.muted,
  textAlign: 'center',
  maxWidth: '600px',
  margin: '0 auto 3rem',
  lineHeight: 1.7,
};

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero() {
  const [hoverPrimary, setHoverPrimary] = useState(false);
  const [hoverSecondary, setHoverSecondary] = useState(false);

  return (
    <header
      style={{
        background: `radial-gradient(ellipse 80% 60% at 50% -10%, rgba(59,130,246,0.18) 0%, transparent 70%), ${C.bg}`,
        borderBottom: `1px solid ${C.border}`,
        padding: '6rem 1.5rem 5rem',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle grid overlay */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(${C.border}22 1px, transparent 1px), linear-gradient(90deg, ${C.border}22 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '800px', margin: '0 auto' }}>
        {/* Badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: C.greenGlow,
            border: `1px solid ${C.green}44`,
            borderRadius: '999px',
            padding: '0.35rem 1rem',
            marginBottom: '2rem',
            fontSize: '0.8rem',
            fontWeight: 600,
            color: C.green,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block' }} />
          <span style={{ textTransform: 'none' }}>v{pkgVersion}</span> — Apache-2.0 · Open Source
        </div>

        <h1
          style={{
            fontSize: 'clamp(2.4rem, 6vw, 4rem)',
            fontWeight: 800,
            color: C.text,
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            marginBottom: '1.5rem',
          }}
        >
          Program Your{' '}
          <span
            style={{
              background: `linear-gradient(135deg, ${C.primary} 0%, ${C.purple} 100%)`,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            AI Coding Assistants
          </span>
        </h1>

        <p
          style={{
            fontSize: 'clamp(1rem, 2.5vw, 1.25rem)',
            color: C.muted,
            maxWidth: '620px',
            margin: '0 auto 2.5rem',
            lineHeight: 1.7,
          }}
        >
          AgentBoot compiles traits and personas into native output for 8 AI platforms.
          Deploy consistent, org-aware AI behavior to every repo — compiled once, running everywhere.
        </p>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '3.5rem' }}>
          <Link
            to="/docs/getting-started"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: hoverPrimary
                ? C.primaryHover
                : `linear-gradient(135deg, ${C.primary} 0%, #6366f1 100%)`,
              color: '#fff',
              padding: '0.8rem 1.75rem',
              borderRadius: '8px',
              fontWeight: 700,
              fontSize: '1rem',
              textDecoration: 'none',
              border: 'none',
              boxShadow: hoverPrimary
                ? `0 0 32px ${C.primaryGlow}, 0 4px 16px rgba(0,0,0,0.4)`
                : `0 0 20px ${C.primaryGlow}, 0 2px 8px rgba(0,0,0,0.3)`,
              transition: 'all 0.18s ease',
              transform: hoverPrimary ? 'translateY(-1px)' : 'none',
            }}
            onMouseEnter={() => setHoverPrimary(true)}
            onMouseLeave={() => setHoverPrimary(false)}
          >
            Get Started Free →
          </Link>
          <a
            href="https://github.com/agentboot-dev/agentboot"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: hoverSecondary ? C.surfaceHover : C.surface,
              color: C.text,
              padding: '0.8rem 1.75rem',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '1rem',
              textDecoration: 'none',
              border: `1px solid ${C.border}`,
              transition: 'all 0.18s ease',
              transform: hoverSecondary ? 'translateY(-1px)' : 'none',
              boxShadow: hoverSecondary ? '0 4px 16px rgba(0,0,0,0.3)' : 'none',
            }}
            onMouseEnter={() => setHoverSecondary(true)}
            onMouseLeave={() => setHoverSecondary(false)}
          >
            {/* GitHub icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            View on GitHub
          </a>
        </div>

        {/* Workflow code snippet */}
        <HeroCodeBlock />
      </div>
    </header>
  );
}

function HeroCodeBlock() {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        overflow: 'hidden',
        maxWidth: '680px',
        margin: '0 auto',
        textAlign: 'left',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}
    >
      {/* Window chrome */}
      <div
        style={{
          background: '#0d1929',
          padding: '0.75rem 1rem',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
        <span style={{ marginLeft: '0.75rem', color: C.muted, fontSize: '0.78rem', fontFamily: 'monospace' }}>
          ~/code/my-org
        </span>
      </div>

      <div style={{ padding: '1.5rem 1.75rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.88rem', lineHeight: 1.9 }}>
        <CodeLine prompt="$" command="agentboot install" comment="# creates hub, builds &amp; syncs" />
        <div style={{ color: C.muted, paddingLeft: '1.2rem', marginBottom: '0.75rem', fontSize: '0.82rem' }}>
          ✓ Scaffolded personas/ &nbsp;✓ Built 4 personas × 8 platforms<br />
          ✓ Synced → 6 repos across 2 teams
        </div>
        <CodeLine prompt="$" command="cd acme-widget-service &amp;&amp; claude" comment="" />
        <div style={{ color: C.muted, paddingLeft: '1.2rem', marginBottom: '0.75rem', fontSize: '0.82rem' }}>
          Claude Code started
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ color: C.purple, userSelect: 'none', fontWeight: 700 }}>✦</span>
          <span style={{ color: C.text }}>
            /ab How do I import all of our company's awesome prompts,<br />
            <span style={{ paddingLeft: '1.2rem' }}>skills, and personas all in one fell swoop?</span>
          </span>
        </div>
        {/* Claude's response */}
        <div style={{ marginTop: '0.75rem', fontSize: '0.82rem', lineHeight: 1.8, color: C.muted }}>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
            <span style={{ color: C.primary, flexShrink: 0 }}>⏺</span>
            <span>
              That's an import — pulling your existing agentic content into the hub.
              Let me scan first so you know exactly what would be imported before anything changes.
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'baseline', marginTop: '0.4rem' }}>
            <span style={{ color: C.primary, flexShrink: 0 }}>⏺</span>
            <span>
              <span style={{ color: C.amber }}>agentboot</span>
              <span style={{ color: C.muted }}> — </span>
              <span style={{ color: C.text }}>agentboot_scan_for_import</span>
              <span style={{ color: C.green, fontSize: '0.78rem' }}> (MCP)</span>
            </span>
          </div>
          <div style={{ marginLeft: '1.1rem', color: C.muted, fontSize: '0.78rem' }}>
            ⎿ &nbsp;&#123; "highConfidence": 12, "needsReview": 3, ... &#125;
          </div>
        </div>
      </div>
    </div>
  );
}

function CodeLine({ prompt, command, comment }: { prompt: string; command: string; comment: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.2rem' }}>
      <span style={{ color: C.green, userSelect: 'none' }}>{prompt}</span>
      <span style={{ color: C.text, fontWeight: 600 }}>{command}</span>
      <span style={{ color: C.muted }}>{comment}</span>
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────
function StatsBar() {
  const stats = [
    { value: '8', label: 'Output Platforms' },
    { value: '4', label: 'Core Personas' },
    { value: '944', label: 'Tests Passing' },
    { value: 'Apache-2.0', label: 'Licensed' },
    { value: '0', label: 'TypeScript Errors' },
  ];

  return (
    <div
      style={{
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          ...containerStyle,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 0,
        }}
      >
        {stats.map((s, i) => (
          <div
            key={i}
            style={{
              padding: '1.5rem 2.5rem',
              textAlign: 'center',
              borderRight: i < stats.length - 1 ? `1px solid ${C.border}` : 'none',
              flex: '1 1 140px',
            }}
          >
            <div
              style={{
                fontSize: '1.75rem',
                fontWeight: 800,
                color: C.primary,
                letterSpacing: '-0.02em',
                lineHeight: 1,
                marginBottom: '0.3rem',
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: '0.8rem', color: C.muted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── How It Works ─────────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    {
      number: '01',
      title: 'Author',
      subtitle: 'Write traits and personas in markdown',
      description:
        'Define AI behavior as source code. Traits are reusable behavioral building blocks — critical thinking, source citation, structured output. Compose them into personas with a single config file.',
      code: `# core/traits/critical-thinking.md
---
name: critical-thinking
weight: HIGH
---

Examine claims before accepting them.
Flag assumptions. Request evidence.`,
      color: C.primary,
    },
    {
      number: '02',
      title: 'Compile',
      subtitle: 'One command, 8 platform-native formats',
      description:
        '`agentboot build` resolves trait references, inlines weights, and emits platform-native output simultaneously. Claude Code gets `.claude/agents/`. Copilot gets `.github/copilot-instructions.md`. Cursor gets `.cursor/rules/`. All from one source.',
      code: `$ agentboot build

  dist/claude/   → .claude/agents/
  dist/copilot/  → .github/
  dist/cursor/   → .cursor/rules/
  dist/gemini/   → GEMINI.md
  dist/agents/   → AGENTS.md
  dist/windsurf/ → .windsurfrules
  +2 more platforms`,
      color: C.purple,
    },
    {
      number: '03',
      title: 'Deploy',
      subtitle: 'Sync to every repo in one step',
      description:
        '`agentboot sync` reads your repos list, applies scope merging (org → group → team), and writes platform-native files to every target repo. Manifests track file hashes so re-syncs are idempotent.',
      code: `$ agentboot sync

  Syncing core personas...
  ✓ github/api-service      (claude, copilot)
  ✓ github/frontend-app     (claude, cursor)
  ✓ github/data-pipeline    (gemini, agents)
  ✓ github/mobile-ios       (copilot, jetbrains)

  12 repos updated · 0 conflicts`,
      color: C.green,
    },
  ];

  return (
    <section style={{ ...sectionBase, background: C.bg }}>
      <div style={containerStyle}>
        <h2 style={sectionHeadingStyle}>How It Works</h2>
        <p style={sectionSubStyle}>
          Three steps from authoring to deployed AI behavior across your entire organization.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {steps.map((step, i) => (
            <StepCard key={i} step={step} reverse={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

function StepCard({
  step,
  reverse,
}: {
  step: { number: string; title: string; subtitle: string; description: string; code: string; color: string };
  reverse: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: reverse ? 'row-reverse' : 'row',
        gap: '2.5rem',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      {/* Text side */}
      <div style={{ flex: '1 1 300px' }}>
        <div
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: step.color,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            marginBottom: '0.5rem',
          }}
        >
          Step {step.number}
        </div>
        <h3
          style={{
            fontSize: '1.75rem',
            fontWeight: 800,
            color: C.text,
            marginBottom: '0.35rem',
            letterSpacing: '-0.02em',
          }}
        >
          {step.title}
        </h3>
        <div style={{ fontSize: '1rem', color: step.color, fontWeight: 500, marginBottom: '1rem' }}>
          {step.subtitle}
        </div>
        <p style={{ color: C.muted, lineHeight: 1.8, margin: 0 }}>{step.description}</p>
      </div>

      {/* Code side */}
      <div style={{ flex: '1 1 340px' }}>
        <div
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderLeft: `3px solid ${step.color}`,
            borderRadius: '10px',
            padding: '1.5rem',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.82rem',
            lineHeight: 1.9,
            color: C.muted,
            whiteSpace: 'pre',
            overflowX: 'auto',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}
        >
          {step.code}
        </div>
      </div>
    </div>
  );
}

// ─── Platform support ─────────────────────────────────────────────────────────
function Platforms() {
  const platforms = [
    { name: 'Claude Code', tag: '.claude/', color: '#f97316' },
    { name: 'GitHub Copilot', tag: '.github/', color: '#8b5cf6' },
    { name: 'Cursor', tag: '.cursor/rules/', color: '#06b6d4' },
    { name: 'Windsurf', tag: '.windsurfrules', color: '#3b82f6' },
    { name: 'JetBrains AI', tag: '.junie/', color: '#f59e0b' },
    { name: 'Gemini Code Assist', tag: 'GEMINI.md', color: '#10b981' },
    { name: 'AGENTS.md', tag: 'Universal standard', color: '#94a3b8' },
    { name: 'agentskills.io', tag: 'SKILL.md', color: '#ec4899' },
  ];

  return (
    <section style={{ ...sectionBase, background: C.surface, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
      <div style={containerStyle}>
        <h2 style={sectionHeadingStyle}>8 Platforms. One Source of Truth.</h2>
        <p style={sectionSubStyle}>
          Every platform gets native output — no wrapper scripts, no adapter layers. AgentBoot
          speaks each platform's dialect fluently.
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '1rem',
          }}
        >
          {platforms.map((p) => (
            <PlatformCard key={p.name} platform={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PlatformCard({ platform }: { platform: { name: string; tag: string; color: string } }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? C.surfaceHover : C.bg,
        border: `1px solid ${hovered ? platform.color + '66' : C.border}`,
        borderRadius: '10px',
        padding: '1.25rem 1.5rem',
        transition: 'all 0.18s ease',
        cursor: 'default',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? `0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px ${platform.color}22` : 'none',
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: platform.color,
          marginBottom: '0.75rem',
          boxShadow: `0 0 8px ${platform.color}88`,
        }}
      />
      <div style={{ fontWeight: 700, color: C.text, marginBottom: '0.3rem', fontSize: '0.95rem' }}>
        {platform.name}
      </div>
      <div
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '0.75rem',
          color: platform.color,
          opacity: 0.9,
        }}
      >
        {platform.tag}
      </div>
    </div>
  );
}

// ─── Use cases ────────────────────────────────────────────────────────────────
function UseCases() {
  return (
    <section style={{ ...sectionBase, background: C.bg }}>
      <div style={containerStyle}>
        <h2 style={sectionHeadingStyle}>Built for Two Audiences</h2>
        <p style={sectionSubStyle}>
          Engineers get a work harness that doesn't get in their way. Organizations get consistent AI behavior across every repo.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          <AudienceCard
            title="For Engineers"
            accent={C.primary}
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            }
            tagline="Your work harness. Your personal setup stays yours."
            description="Battle-tested personas for code review, security analysis, test generation, and data modeling. AgentBoot is what your org runs — your personal AI setup is untouched."
            bullets={[
              'Code Reviewer — finds real bugs, not style nits',
              'Security Reviewer — adversarial threat modeling',
              'Test Generator — coverage-aware, pattern-respecting',
              'Test Data Expert — realistic synthetic fixtures',
            ]}
            cta={{ label: 'See how it works', href: '/docs/concepts' }}
          />

          <AudienceCard
            title="For Organizations"
            accent={C.green}
            icon={
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            }
            tagline="Centralized governance, local autonomy"
            description="Define AI behavior at the org level. Distribute to every repo. Enforce compliance centrally while teams customize locally. Four-level scope hierarchy: org → group → team → repo."
            bullets={[
              'One-command deployment to all repos',
              'Scope hierarchy — team overrides group overrides org',
              'Manifest tracking — idempotent re-syncs',
              'Compliance hooks — 3-layer defense-in-depth',
            ]}
            cta={{ label: 'Architecture Overview', href: '/docs/concepts' }}
          />
        </div>
      </div>
    </section>
  );
}

function AudienceCard({
  title,
  accent,
  icon,
  tagline,
  description,
  bullets,
  cta,
}: {
  title: string;
  accent: string;
  icon: React.ReactNode;
  tagline: string;
  description: string;
  bullets: string[];
  cta: { label: string; href: string };
}) {
  const [hovered, setHovered] = useState(false);
  const [ctaHovered, setCtaHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: C.surface,
        border: `1px solid ${hovered ? accent + '44' : C.border}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: '12px',
        padding: '2rem',
        transition: 'all 0.2s ease',
        transform: hovered ? 'translateY(-3px)' : 'none',
        boxShadow: hovered ? `0 12px 40px rgba(0,0,0,0.4), 0 0 0 1px ${accent}22` : '0 2px 8px rgba(0,0,0,0.2)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          borderRadius: '10px',
          background: `${accent}18`,
          color: accent,
          marginBottom: '1.25rem',
        }}
      >
        {icon}
      </div>

      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        {tagline}
      </div>

      <h3 style={{ fontSize: '1.4rem', fontWeight: 800, color: C.text, marginBottom: '0.75rem', letterSpacing: '-0.02em' }}>
        {title}
      </h3>

      <p style={{ color: C.muted, lineHeight: 1.8, marginBottom: '1.5rem', flex: 1 }}>
        {description}
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {bullets.map((b) => (
          <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', color: C.muted, fontSize: '0.9rem' }}>
            <span style={{ color: accent, fontSize: '1rem', lineHeight: 1.5, flexShrink: 0 }}>✓</span>
            {b}
          </li>
        ))}
      </ul>

      <Link
        to={cta.href}
        onMouseEnter={() => setCtaHovered(true)}
        onMouseLeave={() => setCtaHovered(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          color: accent,
          fontWeight: 600,
          fontSize: '0.9rem',
          textDecoration: 'none',
          opacity: ctaHovered ? 1 : 0.85,
          transition: 'opacity 0.15s',
        }}
      >
        {cta.label} →
      </Link>
    </div>
  );
}

// ─── Quick Start ──────────────────────────────────────────────────────────────
function QuickStart() {
  return (
    <section
      style={{
        ...sectionBase,
        background: C.surface,
        borderTop: `1px solid ${C.border}`,
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div style={{ ...containerStyle, maxWidth: '760px' }}>
        <h2 style={sectionHeadingStyle}>Quick Start</h2>
        <p style={sectionSubStyle}>
          Up and running in under 5 minutes. No AI provider account required for core features.
        </p>

        <div
          style={{
            background: C.bg,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          }}
        >
          {/* Terminal chrome */}
          <div
            style={{
              background: '#0a1120',
              borderBottom: `1px solid ${C.border}`,
              padding: '0.75rem 1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#f59e0b' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981' }} />
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '0.75rem',
                color: C.muted,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              ~/code/my-org
            </span>
          </div>

          <div
            style={{
              padding: '1.75rem 2rem',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '0.9rem',
              lineHeight: 2,
            }}
          >
            {/* Step 1: Install package */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
              <span style={{ color: C.green, userSelect: 'none' }}>$</span>
              <span style={{ color: C.text, fontWeight: 500 }}>npm install -g agentboot</span>
              <span style={{ color: C.muted }}># install globally</span>
            </div>
            {/* Step 2: Run install wizard — builds + syncs automatically */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
              <span style={{ color: C.green, userSelect: 'none' }}>$</span>
              <span style={{ color: C.text, fontWeight: 500 }}>agentboot install</span>
              <span style={{ color: C.muted }}># creates hub, builds &amp; syncs — done</span>
            </div>
            <div style={{ color: C.muted, paddingLeft: '1.2rem', fontSize: '0.82rem', lineHeight: 1.7, marginBottom: '0.5rem' }}>
              ✓ Scaffolded personas/ &nbsp;✓ Built 4 personas × 8 platforms &nbsp;✓ Synced → all repos
            </div>
            {/* Step 3: Go to a work repo and open Claude */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
              <span style={{ color: C.green, userSelect: 'none' }}>$</span>
              <span style={{ color: C.text, fontWeight: 500 }}>cd acme-widget-service &amp;&amp; claude</span>
            </div>
            {/* Step 4: Use /ab */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', marginTop: '0.25rem' }}>
              <span style={{ color: C.purple, userSelect: 'none', fontWeight: 700, lineHeight: 2 }}>✦</span>
              <span style={{ color: C.text, fontWeight: 500, lineHeight: 2 }}>
                /ab How do I import all of our company's awesome prompts, skills, and personas all in one fell swoop?
              </span>
            </div>
            {/* Claude's response — real /ab output pattern */}
            <div style={{ marginTop: '0.4rem', fontSize: '0.83rem', lineHeight: 1.85, color: C.muted }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ color: C.primary, flexShrink: 0 }}>⏺</span>
                <span>
                  That's an import — pulling your existing agentic content into the hub.
                  Let me scan first so you know exactly what would be imported before anything changes.
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', marginTop: '0.5rem' }}>
                <span style={{ color: C.primary, flexShrink: 0 }}>⏺</span>
                <span>
                  <span style={{ color: C.amber }}>agentboot</span>
                  <span style={{ color: C.muted }}> — </span>
                  <span style={{ color: C.text }}>agentboot_scan_for_import</span>
                  <span style={{ color: C.green, fontSize: '0.78rem' }}> (MCP)</span>
                  <span style={{ color: C.muted }}>(paths: [</span>
                  <span style={{ color: C.text }}>"~/code/api-service"</span>
                  <span style={{ color: C.muted }}>, </span>
                  <span style={{ color: C.text }}>"~/code/frontend"</span>
                  <span style={{ color: C.muted }}>, ...])</span>
                </span>
              </div>
              <div style={{ marginLeft: '1.2rem', fontSize: '0.78rem', color: C.muted, marginTop: '0.1rem' }}>
                ⎿ &nbsp;&#123; "highConfidence": 12, "needsReview": 3, "skipped": 1 &#125;
              </div>
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <Link
            to="/docs/getting-started"
            style={{
              color: C.primary,
              fontWeight: 600,
              textDecoration: 'none',
              fontSize: '1rem',
            }}
          >
            Read the full Getting Started guide →
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── CTA Strip ────────────────────────────────────────────────────────────────
function CTAStrip() {
  const [hovered, setHovered] = useState(false);

  return (
    <section
      style={{
        ...sectionBase,
        background: `radial-gradient(ellipse 70% 80% at 50% 50%, rgba(59,130,246,0.12) 0%, transparent 70%), ${C.bg}`,
        textAlign: 'center',
      }}
    >
      <div style={{ ...containerStyle, maxWidth: '680px' }}>
        <h2
          style={{
            fontSize: 'clamp(1.6rem, 4vw, 2.5rem)',
            fontWeight: 800,
            color: C.text,
            letterSpacing: '-0.03em',
            marginBottom: '1rem',
          }}
        >
          Start in 5 minutes.
        </h2>
        <p style={{ ...sectionSubStyle, marginBottom: '2.5rem' }}>
          No AI provider account needed for core features. Apache-2.0 licensed. Self-hosted.
          Your prompts never leave your machine.
        </p>

        <Link
          to="/docs/getting-started"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: hovered
              ? C.primaryHover
              : `linear-gradient(135deg, ${C.primary} 0%, #6366f1 100%)`,
            color: '#fff',
            padding: '0.9rem 2.25rem',
            borderRadius: '8px',
            fontWeight: 700,
            fontSize: '1.05rem',
            textDecoration: 'none',
            boxShadow: hovered
              ? `0 0 40px ${C.primaryGlow}, 0 8px 24px rgba(0,0,0,0.4)`
              : `0 0 24px ${C.primaryGlow}, 0 4px 12px rgba(0,0,0,0.3)`,
            transition: 'all 0.18s ease',
            transform: hovered ? 'translateY(-2px)' : 'none',
          }}
        >
          Read the Getting Started Guide →
        </Link>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="AgentBoot compiles traits and personas into native output for 8 AI platforms. Your AI behavior as code — compiled, versioned, and deployed to every repo in your org."
    >
      <div style={{ background: C.bg, minHeight: '100vh' }}>
        <Hero />
        <StatsBar />
        <HowItWorks />
        <Platforms />
        <UseCases />
        <QuickStart />
        <CTAStrip />
      </div>
    </Layout>
  );
}

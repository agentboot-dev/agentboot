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
  primary: '#3b82f6',
  primaryHover: '#2563eb',
  primaryGlow: 'rgba(59, 130, 246, 0.15)',
  text: '#f8fafc',
  muted: '#94a3b8',
  green: '#10b981',
  greenGlow: 'rgba(16, 185, 129, 0.12)',
  amber: '#f59e0b',
  purple: '#8b5cf6',
  slash: '#818cf8',
};

const sectionBase: React.CSSProperties = { width: '100%', padding: '5rem 1.5rem' };
const containerStyle: React.CSSProperties = { maxWidth: '1100px', margin: '0 auto' };
const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '2rem', fontWeight: 700, color: C.text, textAlign: 'center',
  marginBottom: '0.75rem', letterSpacing: '-0.02em',
};
const sectionSubStyle: React.CSSProperties = {
  fontSize: '1.1rem', color: C.muted, textAlign: 'center', maxWidth: '640px',
  margin: '0 auto 3rem', lineHeight: 1.7,
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
        padding: '6rem 1.5rem 4rem', textAlign: 'center', position: 'relative', overflow: 'hidden',
      }}
    >
      <div aria-hidden style={{
        position: 'absolute', inset: 0,
        backgroundImage: `linear-gradient(${C.border}22 1px, transparent 1px), linear-gradient(90deg, ${C.border}22 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)',
        pointerEvents: 'none',
      }} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: '820px', margin: '0 auto' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: C.greenGlow,
          border: `1px solid ${C.green}44`, borderRadius: '999px', padding: '0.35rem 1rem',
          marginBottom: '2rem', fontSize: '0.8rem', fontWeight: 600, color: C.green,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block' }} />
          <strong>v{pkgVersion} · Public Beta</strong>
          <span style={{ color: C.muted, fontWeight: 500 }}>— Apache-2.0 · Open Source</span>
        </div>

        <h1 style={{
          fontSize: 'clamp(2.4rem, 6vw, 4rem)', fontWeight: 800, color: C.text, lineHeight: 1.1,
          letterSpacing: '-0.03em', marginBottom: '1.5rem',
        }}>
          Stop copy-pasting your AI's rules across repos.
          <br />
          <span style={{
            background: `linear-gradient(135deg, ${C.primary} 0%, ${C.purple} 100%)`,
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            AI behavior as code.
          </span>
        </h1>

        <p style={{
          fontSize: 'clamp(1rem, 2.5vw, 1.25rem)', color: C.muted, maxWidth: '680px',
          margin: '0 auto 2.5rem', lineHeight: 1.7,
        }}>
          One source of truth for how your AI agents behave — compiled to native config for Claude
          Code, OpenAI Codex, and GitHub Copilot, versioned, and delivered to every repo by pull
          request. So every assistant actually knows your codebase, not just the prompt in front of it.
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '3rem' }}>
          <Link to="/docs/getting-started"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              background: hoverPrimary ? C.primaryHover : `linear-gradient(135deg, ${C.primary} 0%, #6366f1 100%)`,
              color: '#fff', padding: '0.8rem 1.75rem', borderRadius: '8px', fontWeight: 700,
              fontSize: '1rem', textDecoration: 'none', border: 'none',
              boxShadow: `0 0 20px ${C.primaryGlow}, 0 2px 8px rgba(0,0,0,0.3)`,
              transition: 'all 0.18s ease', transform: hoverPrimary ? 'translateY(-1px)' : 'none',
            }}
            onMouseEnter={() => setHoverPrimary(true)} onMouseLeave={() => setHoverPrimary(false)}>
            First win in five minutes →
          </Link>
          <a href="https://github.com/agentboot-dev/agentboot" target="_blank" rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              background: hoverSecondary ? C.surfaceHover : C.surface, color: C.text,
              padding: '0.8rem 1.75rem', borderRadius: '8px', fontWeight: 600, fontSize: '1rem',
              textDecoration: 'none', border: `1px solid ${C.border}`, transition: 'all 0.18s ease',
            }}
            onMouseEnter={() => setHoverSecondary(true)} onMouseLeave={() => setHoverSecondary(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            View on GitHub
          </a>
        </div>

        <HeroTerminal />
      </div>
    </header>
  );
}

function HeroTerminal() {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden',
      maxWidth: '700px', margin: '0 auto', textAlign: 'left', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        background: '#0d1929', padding: '0.75rem 1rem', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: '0.5rem',
      }}>
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#f59e0b' }} />
        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981' }} />
        <span style={{ marginLeft: '0.75rem', color: C.muted, fontSize: '0.78rem', fontFamily: 'monospace' }}>~/code/my-org</span>
      </div>
      <div style={{ padding: '1.5rem 1.75rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.86rem', lineHeight: 1.9 }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <span style={{ color: C.green }}>$</span><span style={{ color: C.text, fontWeight: 600 }}>agentboot build</span>
          <span style={{ color: C.muted }}># compile the hub → native config</span>
        </div>
        <div style={{ color: C.muted, paddingLeft: '1.2rem', fontSize: '0.8rem', marginBottom: '0.6rem' }}>
          ✓ 5 personas → Claude Code · Codex · Copilot
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <span style={{ color: C.green }}>$</span><span style={{ color: C.text, fontWeight: 600 }}>agentboot sync</span>
          <span style={{ color: C.muted }}># deliver to every repo, by PR</span>
        </div>
        <div style={{ color: C.muted, paddingLeft: '1.2rem', fontSize: '0.8rem' }}>
          ✓ 6 repos · <span style={{ color: C.green }}>Opened PR #214</span> — agent-config files only
        </div>
        <div style={{ color: C.muted, paddingLeft: '1.2rem', fontSize: '0.78rem', opacity: 0.75 }}>
          the pull request is the record — review it like any other change
        </div>
      </div>
    </div>
  );
}

// ─── Trust strip ──────────────────────────────────────────────────────────────
function TrustStrip() {
  // "by default": there is no default endpoint and no phone-home — nothing ever
  // reaches the AgentBoot vendor. An org MAY configure its own telemetry sink
  // (telemetry.sink), in which case batches ship to that org-owned collector.
  const signals: Array<{ label: string; title?: string }> = [
    { label: 'Self-hosted' },
    {
      label: 'Zero data transmitted by default',
      title: 'No default endpoint, no phone-home — nothing ever reaches the AgentBoot vendor. If your org configures its own telemetry sink, batches ship only to that org-owned collector.',
    },
    { label: 'Apache-2.0' },
    { label: 'Plain files out' },
    { label: 'Delivered by pull request' },
  ];
  return (
    <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
      <div style={{
        ...containerStyle, display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
        gap: '0.75rem 2.5rem', padding: '1.25rem 1.5rem',
      }}>
        {signals.map((s) => (
          <span key={s.label} title={s.title} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', color: C.muted, fontSize: '0.88rem', fontWeight: 500 }}>
            <span style={{ color: C.green }}>✓</span>{s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Recognition row (self-sort) ────────────────────────────────────────────────
function RecognitionRow() {
  const cards = [
    {
      quote: '“My AI tools write plausible code that’s wrong about our codebase.”',
      lead: 'Stop re-explaining your codebase', accent: C.primary,
      body: 'Teach every assistant your conventions, your gotchas, your review bar — once — and stop re-explaining them in every prompt.',
      cta: { label: 'For engineers →', to: '/docs/concepts' },
    },
    {
      quote: '“Five teams adopted AI five ways, and I answer for all of it.”',
      lead: 'Get one control surface', accent: C.green,
      body: 'Define behavior at the org level, deliver it to every repo by pull request, and see when a repo drifts from what you shipped.',
      cta: { label: 'For your org →', to: '/for-organizations' },
    },
    {
      quote: '“My org already runs AgentBoot — I just need to connect.”',
      lead: 'Connect in two commands', accent: C.purple,
      body: 'Point one repo at the hub. Nothing touches your personal setup. You can read exactly what changes before it does.',
      cta: { label: 'Connect a repo →', to: '/docs/getting-started' },
    },
  ];
  return (
    <section style={{ ...sectionBase, background: C.bg }}>
      <div style={containerStyle}>
        <h2 style={sectionHeadingStyle}>Which one is you?</h2>
        <p style={sectionSubStyle}>No forms. Pick the sentence that sounds like your week.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
          {cards.map((c) => <SituationCard key={c.lead} {...c} />)}
        </div>
      </div>
    </section>
  );
}

function SituationCard({ quote, lead, body, accent, cta }: {
  quote: string; lead: string; body: string; accent: string; cta: { label: string; to: string };
}) {
  const [h, setH] = useState(false);
  return (
    <Link to={cta.to} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', flexDirection: 'column', textDecoration: 'none',
        background: C.surface, border: `1px solid ${h ? accent + '55' : C.border}`, borderTop: `3px solid ${accent}`,
        borderRadius: '12px', padding: '1.75rem', transition: 'all 0.2s ease',
        transform: h ? 'translateY(-3px)' : 'none',
        boxShadow: h ? `0 12px 40px rgba(0,0,0,0.4)` : '0 2px 8px rgba(0,0,0,0.2)',
      }}>
      <div style={{ color: C.text, fontSize: '1.05rem', lineHeight: 1.5, marginBottom: '1rem', fontWeight: 500 }}>{quote}</div>
      <div style={{ color: accent, fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>{lead}</div>
      <p style={{ color: C.muted, lineHeight: 1.7, fontSize: '0.92rem', flex: 1, margin: '0 0 1.25rem' }}>{body}</p>
      <span style={{ color: accent, fontWeight: 600, fontSize: '0.9rem' }}>{cta.label}</span>
    </Link>
  );
}

// ─── How it works ───────────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    { n: '01', title: 'Author', color: C.primary, body: 'Write traits, personas, and rules as markdown in one hub repo. Reusable behavioral building blocks, composed with a single config file.' },
    { n: '02', title: 'Compile', color: C.purple, body: '`agentboot build` resolves references and emits native config for each supported tool — Claude Code, OpenAI Codex, GitHub Copilot — from one source.' },
    { n: '03', title: 'Deliver', color: C.green, body: '`agentboot sync` writes those files to every target repo as a pull request. Drift detection flags any repo that no longer matches what you shipped.' },
  ];
  return (
    <section style={{ ...sectionBase, background: C.surface, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
      <div style={containerStyle}>
        <h2 style={sectionHeadingStyle}>How it works, in 90 seconds</h2>
        <p style={sectionSubStyle}>AgentBoot is a build tool, not a runtime. It produces files and exits — nothing runs alongside your agents.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
          {steps.map((s) => (
            <div key={s.n} style={{ background: C.bg, border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, borderRadius: '12px', padding: '1.75rem' }}>
              <div style={{ color: s.color, fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>STEP {s.n}</div>
              <h3 style={{ color: C.text, fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.75rem' }}>{s.title}</h3>
              <p style={{ color: C.muted, lineHeight: 1.75, margin: 0 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── The wedge ──────────────────────────────────────────────────────────────────
function Wedge() {
  const rows = [
    { alt: 'Script it yourself', breaks: 'Scripts distribute files — but they can’t review, enforce, or tell you when a repo drifted.' },
    { alt: 'Use each tool’s built-in settings', breaks: 'Settings restrict what an agent may do — but they can’t teach it your conventions, and they don’t cross tools.' },
    { alt: 'Copy-paste rules across repos', breaks: 'It works on day one — then forks, drifts, and no two repos agree a month later.' },
  ];
  return (
    <section style={{ ...sectionBase, background: C.bg }}>
      <div style={containerStyle}>
        <h2 style={sectionHeadingStyle}>“But I could just…”</h2>
        <p style={sectionSubStyle}>You can — until you have more than one repo and more than one tool. Here’s where each shortcut stops working.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '820px', margin: '0 auto' }}>
          {rows.map((r) => (
            <div key={r.alt} style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', background: C.surface, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '1.25rem 1.5rem' }}>
              <div style={{ flex: '1 1 200px', color: C.text, fontWeight: 700 }}>{r.alt}</div>
              <div style={{ flex: '2 1 380px', color: C.muted, lineHeight: 1.7 }}>{r.breaks}</div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <Link to="/why" style={{ color: C.primary, fontWeight: 600, textDecoration: 'none' }}>Why AgentBoot exists →</Link>
        </div>
      </div>
    </section>
  );
}

// ─── Two audiences ──────────────────────────────────────────────────────────────
function TwoAudience() {
  return (
    <section style={{ ...sectionBase, background: C.surface, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
      <div style={containerStyle}>
        <h2 style={sectionHeadingStyle}>Two audiences, one source</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
          <AudienceCard title="For engineers" accent={C.primary}
            tagline="Your rig stays yours."
            body="AgentBoot is what your team runs — your personal AI setup is untouched. Ready-made personas for code review, security analysis, tests, and data. Ask /ab in natural language; it scans before it changes anything."
            bullets={[
              'Your personal config is never overwritten',
              '/ab — natural-language interface, scan-first',
              'Import your existing CLAUDE.md / AGENTS.md / rules files',
              'Plain files out — everything works even without AgentBoot',
            ]}
            cta={{ label: 'See a persona compile', href: '/docs/concepts' }} />
          <AudienceCard title="For your org" accent={C.green}
            tagline="One control surface."
            body="Define behavior at the org level and deliver it to every repo by pull request. Scope hierarchy — org → group → team → repo — lets teams customize without escaping policy. Drift detection shows you when a repo no longer matches what you shipped."
            bullets={[
              'org → group → team → repo scope hierarchy',
              'Drift you can see — content-hash comparison per repo',
              'Managed settings & blocking hooks on supported CLIs',
              'Delivered by PR — review it like any other change',
            ]}
            cta={{ label: 'Read the governance model', href: '/for-organizations' }} />
        </div>
      </div>
    </section>
  );
}

function AudienceCard({ title, accent, tagline, body, bullets, cta }: {
  title: string; accent: string; tagline: string; body: string; bullets: string[]; cta: { label: string; href: string };
}) {
  const [h, setH] = useState(false);
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: C.bg, border: `1px solid ${h ? accent + '44' : C.border}`, borderTop: `3px solid ${accent}`,
        borderRadius: '12px', padding: '2rem', transition: 'all 0.2s ease', transform: h ? 'translateY(-3px)' : 'none',
        display: 'flex', flexDirection: 'column',
      }}>
      <div style={{ color: accent, fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>{tagline}</div>
      <h3 style={{ color: C.text, fontSize: '1.4rem', fontWeight: 800, margin: '0 0 0.75rem' }}>{title}</h3>
      <p style={{ color: C.muted, lineHeight: 1.75, marginBottom: '1.25rem', flex: 1 }}>{body}</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
        {bullets.map((b) => (
          <li key={b} style={{ display: 'flex', gap: '0.6rem', color: C.muted, fontSize: '0.9rem' }}>
            <span style={{ color: accent, flexShrink: 0 }}>✓</span>{b}
          </li>
        ))}
      </ul>
      <Link to={cta.href} style={{ color: accent, fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none' }}>{cta.label} →</Link>
    </div>
  );
}

// ─── Governance & trust ─────────────────────────────────────────────────────────
function Governance() {
  const phases = [
    { k: 'Set', color: C.primary, body: 'Author behavior and policy once, in one hub repo — versioned and reviewable like any other code.' },
    { k: 'Enforce', color: C.purple, body: 'Emit blocking pre-tool-use hooks and managed settings to the CLIs that support them — the rule fires at the tool boundary rather than asking the agent to comply. Depth varies by platform; the matrix below says where.' },
    { k: 'Verify', color: C.green, body: 'Drift detection compares each repo against what you shipped and flags what no longer matches. Every delivery is a reviewable PR.' },
  ];
  const rows = [
    ['Compiled instructions', '✓', '✓', '✓'],
    ['Blocking pre-tool-use hooks', '✓', '✓', '✓ *'],
    ['Managed settings', '✓', '—', '—'],
    ['Drift detection', '✓', '✓', '✓'],
  ];
  return (
    <section style={{ ...sectionBase, background: C.bg }}>
      <div style={containerStyle}>
        <h2 style={sectionHeadingStyle}>Set. Enforce. Verify.</h2>
        <p style={sectionSubStyle}>The same three questions a security reviewer already asks — answered by pull requests and hashes, not promises.</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem', marginBottom: '3rem' }}>
          {phases.map((p) => (
            <div key={p.k} style={{ background: C.surface, border: `1px solid ${C.border}`, borderLeft: `3px solid ${p.color}`, borderRadius: '10px', padding: '1.5rem' }}>
              <div style={{ color: p.color, fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem' }}>{p.k}</div>
              <p style={{ color: C.muted, lineHeight: 1.7, margin: 0, fontSize: '0.92rem' }}>{p.body}</p>
            </div>
          ))}
        </div>

        <div style={{ overflowX: 'auto', maxWidth: '720px', marginLeft: 'auto', marginRight: 'auto' }}>
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '0.9rem', color: C.text }}>
            <colgroup>
              <col style={{ width: '40%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>Capability</th>
                <th style={{ padding: '0.75rem 0.5rem', borderBottom: `1px solid ${C.border}` }}>Claude Code</th>
                <th style={{ padding: '0.75rem 0.5rem', borderBottom: `1px solid ${C.border}` }}>Codex CLI</th>
                <th style={{ padding: '0.75rem 0.5rem', borderBottom: `1px solid ${C.border}` }}>Copilot CLI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[0]}>
                  <td style={{ textAlign: 'left', padding: '0.6rem 1rem', color: C.muted, borderBottom: `1px solid ${C.border}44` }}>{r[0]}</td>
                  <td style={{ textAlign: 'center', padding: '0.6rem 0.5rem', color: C.green, borderBottom: `1px solid ${C.border}44` }}>{r[1]}</td>
                  <td style={{ textAlign: 'center', padding: '0.6rem 0.5rem', color: C.green, borderBottom: `1px solid ${C.border}44` }}>{r[2]}</td>
                  <td style={{ textAlign: 'center', padding: '0.6rem 0.5rem', color: r[3].includes('*') ? C.amber : C.green, borderBottom: `1px solid ${C.border}44` }}>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: C.muted, fontSize: '0.8rem', marginTop: '0.75rem', lineHeight: 1.6 }}>
            Official support today covers each tool’s <strong>CLI surface</strong>. Broader surface support — IDE and editor
            extensions, and additional platforms — is <Link to="/docs/roadmap" style={{ color: C.primary }}>on the roadmap</Link>.
            {' '}* Copilot’s hook surface is narrower than Claude Code’s and Codex’s — real, but lower-ceiling, and its
            exit-2 blocking is documented rather than yet empirically verified; we say so on purpose.
            Cursor, Windsurf, Gemini, and JetBrains are supported at a <strong>community tier</strong> — advisory guidance,
            not an enforced control. If a cell says advisory, treat it as advisory.
          </p>
        </div>

        <div style={{ textAlign: 'center', marginTop: '2rem', display: 'flex', gap: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/trust" style={{ color: C.primary, fontWeight: 600, textDecoration: 'none' }}>Trust &amp; architecture →</Link>
          <Link to="/docs/platform-capability-matrix" style={{ color: C.primary, fontWeight: 600, textDecoration: 'none' }}>Full capability matrix →</Link>
        </div>
      </div>
    </section>
  );
}

// ─── What it doesn't do ──────────────────────────────────────────────────────────
function DoesntDo() {
  const items = [
    'It is not a sandbox for agent execution. It configures the tools; it doesn’t run alongside them.',
    'Blocking hooks bind the CLI surfaces that support them — not a developer who uninstalls the tool.',
    'It won’t manage your personal AI setup. That stays yours; AgentBoot only writes what the org ships.',
    'It’s probably not for you if you’re one person on one repo. A checked-in config file is fine there.',
  ];
  return (
    <section style={{ ...sectionBase, background: C.surface, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ ...containerStyle, maxWidth: '780px' }}>
        <h2 style={sectionHeadingStyle}>What AgentBoot doesn’t do</h2>
        <p style={sectionSubStyle}>The honest boundary — because the last thing you should read before installing is where the tool stops.</p>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {items.map((t) => (
            <li key={t} style={{ display: 'flex', gap: '0.75rem', color: C.muted, lineHeight: 1.7, background: C.bg, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '1rem 1.25rem' }}>
              <span style={{ color: C.amber, flexShrink: 0, fontWeight: 700 }}>—</span>{t}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ─── Quick start ────────────────────────────────────────────────────────────────
function QuickStart() {
  return (
    <section style={{ ...sectionBase, background: C.bg }}>
      <div style={{ ...containerStyle, maxWidth: '760px' }}>
        <h2 style={sectionHeadingStyle}>First win in five minutes</h2>
        <p style={sectionSubStyle}>No AI-provider account needed for core features.</p>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: '12px', overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.4)' }}>
          <div style={{ background: '#0a1120', borderBottom: `1px solid ${C.border}`, padding: '0.75rem 1.25rem', display: 'flex', gap: '0.5rem' }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ef4444' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#f59e0b' }} />
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981' }} />
          </div>
          <div style={{ padding: '1.75rem 2rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.9rem', lineHeight: 2 }}>
            <div><span style={{ color: C.green }}>$ </span><span style={{ color: C.text }}>npm install -g agentboot</span><span style={{ color: C.muted }}>  # install globally</span></div>
            <div><span style={{ color: C.green }}>$ </span><span style={{ color: C.text }}>agentboot install</span><span style={{ color: C.muted }}>  # scaffold a hub, build &amp; sync</span></div>
            <div style={{ color: C.muted, paddingLeft: '1.2rem', fontSize: '0.82rem' }}>✓ Scaffolded hub  ✓ Built personas → Claude Code · Codex · Copilot</div>
            <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
              <span style={{ color: C.purple, fontWeight: 700 }}>✦</span>
              <span style={{ color: C.text }}><span style={{ color: C.slash }}>/ab</span> import our existing prompts and rules</span>
            </div>
            <div style={{ paddingLeft: '1.6rem', color: C.muted, fontSize: '0.82rem' }}>⏺ Scanning first so you see exactly what would import — nothing changes yet.</div>
            <div style={{ paddingLeft: '1.6rem', color: C.muted, fontSize: '0.8rem' }}>⎿ &#123; "highConfidence": 12, "needsReview": 3 &#125;</div>
          </div>
        </div>
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <Link to="/docs/getting-started" style={{ color: C.primary, fontWeight: 600, textDecoration: 'none' }}>Read the Getting Started guide →</Link>
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA + handshake ───────────────────────────────────────────────────────
function CTAStrip() {
  return (
    <section style={{ ...sectionBase, background: `radial-gradient(ellipse 70% 80% at 50% 50%, rgba(59,130,246,0.12) 0%, transparent 70%), ${C.bg}`, textAlign: 'center' }}>
      <div style={{ ...containerStyle, maxWidth: '720px' }}>
        <h2 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.5rem)', fontWeight: 800, color: C.text, letterSpacing: '-0.03em', marginBottom: '1rem' }}>
          Teach your tools once.
        </h2>
        <p style={{ ...sectionSubStyle, marginBottom: '2.25rem' }}>
          Self-hosted, Apache-2.0, plain files out. Your prompts never leave your machine.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '2.5rem' }}>
          <Link to="/docs/getting-started" style={{ background: `linear-gradient(135deg, ${C.primary} 0%, #6366f1 100%)`, color: '#fff', padding: '0.9rem 2rem', borderRadius: '8px', fontWeight: 700, fontSize: '1.05rem', textDecoration: 'none', boxShadow: `0 0 24px ${C.primaryGlow}` }}>
            First win in five minutes →
          </Link>
          <Link to="/for-organizations" style={{ background: C.surface, color: C.text, padding: '0.9rem 2rem', borderRadius: '8px', fontWeight: 600, fontSize: '1.05rem', textDecoration: 'none', border: `1px solid ${C.border}` }}>
            Evaluate for your org →
          </Link>
        </div>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap', fontSize: '0.9rem' }}>
          <span style={{ color: C.muted }}>Not the right person to decide?</span>
          <Link to="/for-organizations" style={{ color: C.primary, textDecoration: 'none', fontWeight: 600 }}>Send the governance model to your platform lead →</Link>
        </div>
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
      description="AgentBoot compiles your team's AI behavior into native config for Claude Code, OpenAI Codex, and GitHub Copilot, and ships it to every repo as a reviewable pull request — self-hosted, verified against drift."
    >
      <div style={{ background: C.bg, minHeight: '100vh' }}>
        <Hero />
        <TrustStrip />
        <RecognitionRow />
        <HowItWorks />
        <Wedge />
        <TwoAudience />
        <Governance />
        <DoesntDo />
        <QuickStart />
        <CTAStrip />
      </div>
    </Layout>
  );
}

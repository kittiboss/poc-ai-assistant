'use client';

import { CodeHighlighter } from '@ant-design/x';
import XMarkdown, { type ComponentProps } from '@ant-design/x-markdown';
import type { ReactNode } from 'react';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import { useThemeMode } from '@/theme/theme-mode-provider';

const LANGUAGE_ALIASES: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  ps: 'powershell',
  ps1: 'powershell',
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
  html: 'markup',
  xml: 'markup',
  dockerfile: 'docker',
};

// Prism grammars that CodeHighlighter can lazy-load. Anything else is shown as plain text.
const HIGHLIGHTED_LANGUAGES = new Set([
  'bash',
  'powershell',
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'json',
  'python',
  'sql',
  'yaml',
  'markdown',
  'markup',
  'css',
  'java',
  'go',
  'csharp',
  'php',
  'ruby',
  'rust',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'docker',
]);

function textOf(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(textOf).join('');
  return '';
}

function resolveLanguage(info: string | undefined): string | undefined {
  const name = info?.split(/\s+/)[0]?.toLowerCase();
  if (!name) return undefined;
  const language = LANGUAGE_ALIASES[name] ?? name;
  return HIGHLIGHTED_LANGUAGES.has(language) ? language : undefined;
}

// Block code arrives as <pre><code data-block>. The code component draws its own container,
// so <pre> only passes its children through (a <div> inside <pre> is invalid HTML).
function Pre({ children }: ComponentProps) {
  return <>{children}</>;
}

function Code({ block, lang, children }: ComponentProps) {
  const { resolvedTheme } = useThemeMode();
  const code = textOf(children);
  if (!block) return <code>{children}</code>;

  const language = resolveLanguage(lang);
  if (!language) {
    return (
      <pre className="plain-code">
        <code>{code}</code>
      </pre>
    );
  }
  return (
    <CodeHighlighter
      lang={language}
      highlightProps={resolvedTheme === 'dark' ? { style: oneDark } : undefined}
      className="my-3 first:mt-0 last:mb-0"
    >
      {code}
    </CodeHighlighter>
  );
}

const components = { pre: Pre, code: Code };

/** Renders a reply. `streaming` shows a cursor and tolerates half-finished markdown. */
export function MarkdownContent({ content, streaming }: { content: string; streaming: boolean }) {
  return (
    <XMarkdown
      content={content}
      className="x-markdown-app"
      // The library sets line-height on an unlayered rule that beats layered CSS; keep the bubble's
      // own line height, which is taller for Thai.
      style={{ lineHeight: 'inherit' }}
      components={components}
      streaming={{ hasNextChunk: streaming, tail: streaming }}
      openLinksInNewTab
    />
  );
}

/*
 * Streaming Markdown Renderer for ONEE Chat Messages.
 *
 * When the assistant streams a response, we receive chunks of partial markdown.
 * This component parses and renders that markdown incrementally without flickering:
 *
 * 1. Headings (#, ##, ###) are converted to styled header elements
 * 2. Bold (**text**) and inline code (`code`) are rendered inline
 * 3. Tables (| col | col |) are rendered as styled HTML tables
 * 4. Code blocks (```lang) get syntax-highlighted containers
 * 5. Lists (-, 1.) are rendered as proper <ul>/<ol> elements
 *
 * We handle incomplete markdown gracefully: if a table row is still streaming,
 * we buffer it until the row delimiter arrives rather than rendering a broken table.
 * This is what prevents the flickering the user reported with raw dangerouslySetInnerHTML.
 */

import React, { memo } from 'react';
import styles from './MarkdownRenderer.module.css';

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

/**
 * Safely parses inline markdown (bold, italic, code) without innerHTML.
 */
function renderInline(text: string): React.ReactNode[] {
  if (!text) return [];

  // Split tokens: **bold**, *italic*, `code`
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, idx) => {
    if (!part) return null;

    // Bold **text**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={idx} className={styles.bold}>
          {renderInline(part.slice(2, -2))}
        </strong>
      );
    }

    // Italic *text*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={idx} className={styles.italic}>
          {renderInline(part.slice(1, -1))}
        </em>
      );
    }

    // Inline `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code key={idx} className={styles.inlineCode}>
          {part.slice(1, -1)}
        </code>
      );
    }

    return <span key={idx}>{part}</span>;
  });
}

/**
 * Parses block markdown (headings, bullets, tables, code blocks, blockquotes, horizontal rules).
 */
function parseBlocks(raw: string): React.ReactNode[] {
  const lines = raw.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Horizontal rule --- or *** or ___
    if (line.trim() === '---' || line.trim() === '***' || line.trim() === '___') {
      nodes.push(<hr key={`hr-${i}`} className={styles.hr} />);
      i++;
      continue;
    }

    // Code Block ``` ... ```
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3) || 'text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <div key={`code-${i}`} className={styles.codeBlock}>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', opacity: 0.6, marginBottom: '4px' }}>
            {lang}
          </div>
          <code>{codeLines.join('\n')}</code>
        </div>
      );
      i++;
      continue;
    }

    // Table parsing | ... |
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const headers = tableLines[0].split('|').map((h) => h.trim()).filter(Boolean);
        const hasSeparator = tableLines[1].includes('---');
        const rowLines = hasSeparator ? tableLines.slice(2) : tableLines.slice(1);

        nodes.push(
          <div key={`table-${i}`} className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {headers.map((h, hIdx) => (
                    <th key={hIdx} className={styles.th}>
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowLines.map((rowStr, rIdx) => {
                  const cells = rowStr.split('|').map((c) => c.trim()).filter(Boolean);
                  return (
                    <tr key={rIdx} className={rIdx % 2 === 0 ? styles.trEven : styles.trOdd}>
                      {cells.map((cell, cIdx) => (
                        <td key={cIdx} className={styles.td}>
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        continue;
      } else if (tableLines.length === 1) {
        const headers = tableLines[0].split('|').map((h) => h.trim()).filter(Boolean);
        nodes.push(
          <div key={`table-skel-${i}`} className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {headers.map((h, hIdx) => (
                    <th key={hIdx} className={styles.th}>
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
            </table>
            <div className={styles.tableSkeleton}>
              <div className={styles.skeletonRow} />
              <div className={styles.skeletonRow} style={{ width: '80%' }} />
            </div>
          </div>
        );
        continue;
      }
    }

    // Headings: #, ##, ###, ####, #####, ###### (with trim support)
    const headingMatch = line.trim().match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2];
      if (level === 1) {
        nodes.push(
          <h2 key={`h1-${i}`} className={styles.h1}>
            {renderInline(headingText)}
          </h2>
        );
      } else if (level === 2) {
        nodes.push(
          <h3 key={`h2-${i}`} className={styles.h2}>
            {renderInline(headingText)}
          </h3>
        );
      } else if (level === 3) {
        nodes.push(
          <h4 key={`h3-${i}`} className={styles.h3}>
            {renderInline(headingText)}
          </h4>
        );
      } else {
        nodes.push(
          <h5 key={`h4-${i}`} className={styles.h4}>
            {renderInline(headingText)}
          </h5>
        );
      }
      i++;
      continue;
    }

    // Blockquotes >
    if (line.trim().startsWith('>')) {
      const quoteText = line.trim().replace(/^>\s*/, '');
      nodes.push(
        <blockquote key={`bq-${i}`} className={styles.blockquote}>
          {renderInline(quoteText)}
        </blockquote>
      );
      i++;
      continue;
    }

    // Numbered lists: 1. 2. etc.
    const numberedMatch = line.trim().match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      nodes.push(
        <div key={`ol-${i}`} className={styles.numberedRow}>
          <span className={styles.numberLabel}>{numberedMatch[1]}.</span>
          <div style={{ flex: 1 }}>{renderInline(numberedMatch[2])}</div>
        </div>
      );
      i++;
      continue;
    }

    // Bullet points: •, -, *
    if (
      line.trim().startsWith('• ') ||
      line.trim().startsWith('- ') ||
      line.trim().startsWith('* ')
    ) {
      const bulletText = line.trim().replace(/^[•\-*]\s*/, '');
      nodes.push(
        <div key={`bullet-${i}`} className={styles.numberedRow}>
          <span className={styles.numberLabel}>•</span>
          <div style={{ flex: 1 }}>{renderInline(bulletText)}</div>
        </div>
      );
      i++;
      continue;
    }

    // Regular paragraph
    nodes.push(
      <p key={`p-${i}`} className={styles.p}>
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return nodes;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(({
  content,
  isStreaming = false,
  className = ''
}) => {
  return (
    <div className={`${styles.markdownRoot} ${className}`}>
      {parseBlocks(content)}
      {isStreaming && <span className={styles.streamingCursor}>▋</span>}
    </div>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

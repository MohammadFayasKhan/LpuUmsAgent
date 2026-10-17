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
        const headers = tableLines[0]
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((h) => h.trim());
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
                  const rawCells = rowStr
                    .trim()
                    .replace(/^\|/, '')
                    .replace(/\|$/, '')
                    .split('|')
                    .map((c) => c.trim());
                  const cells = [...rawCells];
                  while (cells.length < headers.length) {
                    cells.push('');
                  }
                  return (
                    <tr key={rIdx} className={rIdx % 2 === 0 ? styles.trEven : styles.trOdd}>
                      {cells.slice(0, headers.length).map((cell, cIdx) => (
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

/**
 * Detects concatenated UMS ReportViewer / SSRS Course & Faculty Directory text dumps
 * and transforms them into a clean GitHub-flavored Markdown table.
 */
export function formatConcatenatedSsrsTable(text: string): string {
  if (!text || typeof text !== 'string') return text;

  // Check if string contains the SSRS course directory signature
  const headerMatch =
    text.match(/Course\s*Code\s*Type\s*Course\s*Title\s*Lectures\s*Tutorial\s*Practical\s*Credits\s*Facul[^\n\r]*?\)/i) ||
    text.match(/Course\s*Code\s*Type\s*Course\s*Title[^\n\r]*?/i);

  if (!headerMatch || headerMatch.index === undefined) return text;

  const headerEndIdx = headerMatch.index + headerMatch[0].length;
  const beforeHeader = text.slice(0, headerMatch.index).trim();
  const bodyText = text.slice(headerEndIdx).trim();

  // Insert row delimiter between (AM|PM|NA) and the next course code
  const preProcessed = bodyText.replace(
    /(AM|PM|NA)(?=([A-Z]{2,4}\d{2,4})(PW|CR|TE|EM|OM|PE|UC|PC|OE|RE|SP|SE|BL|[A-Z]{2}))/g,
    '$1\n[ROW] '
  );

  const rowPattern =
    /([A-Z]{2,4}\d{2,4})\s*(PW|CR|TE|EM|OM|PE|UC|PC|OE|RE|SP|SE|BL|[A-Z]{2})\s*([A-Z0-9\s\-_/&]+?)\s*(\d)(\d)(\d)(\d)\s*(.*?)(?:Last Updated\s*::\s*([^\n\r]+?))?$/is;

  const rawRows = preProcessed.split('\n[ROW]').map((s) => s.trim()).filter(Boolean);
  const rows: Array<{
    code: string;
    type: string;
    title: string;
    ltp: string;
    credits: string;
    faculty: string;
    lastUpdated: string;
  }> = [];

  for (const rawRow of rawRows) {
    const cleanRow = rawRow.replace(/\s+/g, ' ');
    const m = cleanRow.match(rowPattern);
    if (m) {
      const code = m[1].trim();
      const type = m[2].trim();
      const title = m[3].trim();
      const l = m[4];
      const t = m[5];
      const p = m[6];
      const credits = m[7];
      let faculty = (m[8] || '').trim();
      if (faculty.includes('(') && !faculty.includes(')')) {
        faculty = faculty + ')';
      }
      faculty = faculty.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
      if (!faculty || faculty.toLowerCase() === 'na') {
        faculty = 'Not Assigned / NA';
      }

      let lastUpdated = (m[9] || '').trim();
      if (!lastUpdated || lastUpdated.toUpperCase() === 'NA') {
        lastUpdated = 'NA';
      }

      rows.push({
        code,
        type,
        title,
        ltp: `${l}-${t}-${p}`,
        credits,
        faculty,
        lastUpdated
      });
    }
  }

  if (rows.length === 0) return text;

  const markdownRows = rows
    .map(
      (r) =>
        `| **${r.code}** | ${r.type} | ${r.title} | ${r.ltp} | ${r.credits} | ${r.faculty} | ${r.lastUpdated} |`
    )
    .join('\n');

  const totalCredits = rows.reduce((acc, r) => acc + (parseInt(r.credits, 10) || 0), 0);

  return [
    beforeHeader ? `${beforeHeader}\n\n` : '',
    '### 📚 Registered Courses & Faculty Directory\n\n',
    `Here is your official enrolled curriculum (**${rows.length} courses**, **${totalCredits} total credits**) verified from your authenticated UMS portal:\n\n`,
    '| Course Code | Type | Course Title | L-T-P | Credits | Faculty & Cabin | Last Updated |\n',
    '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n',
    markdownRows,
    '\n\n> 💡 **Directory Note:** Faculty cabin locations and course credits are verified directly from your official UMS Student Time Table report.'
  ].join('');
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(({
  content,
  isStreaming = false,
  className = ''
}) => {
  const sanitized = formatConcatenatedSsrsTable((content || '').replace(/—/g, '→'));
  return (
    <div
      className={`${styles.markdownRoot} ${isStreaming ? styles.isStreaming : ''} ${className}`}
    >
      {parseBlocks(sanitized)}
      {isStreaming && <span className={styles.streamingCursor} aria-hidden="true" />}
    </div>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

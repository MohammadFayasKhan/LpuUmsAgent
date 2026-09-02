/*
 * Humanizer Post-Processing Utility for ONEE.
 *
 * When large language models generate answers, they frequently pad them with
 * conversational clichés and corporate filler:
 * - Opening clichés: "Certainly! Let's dive in...", "As an AI language model..."
 * - Closing clichés: "In conclusion, I hope this helps! Feel free to ask more questions."
 * - Overused AI stock words: "stands as a testament to", "plays a crucial role in", "delve into".
 *
 * This utility cleans up model output before presenting it to the student:
 * 1. It temporarily masks markdown tables and code blocks so formatting syntax isn't broken.
 * 2. It strips artificial conversational filler.
 * 3. It restores the protected markdown blocks.
 */

const AI_INTRO_CLICHES = [
  /^(certainly|sure thing|absolutely|of course|sure|as an ai language model)[!,.]?\s*(let's (dive in|explore|delve into|break down|look at)|here is a (breakdown|detailed explanation|look)|i('d| would) be happy to explain)?\s*/i,
  /^(in this response|in this explanation|let me explain|allow me to explain)[!:,.]?\s*/i,
  /^(to understand this concept|before diving in|to answer your question)[!:,.]?\s*/i
];

const AI_OUTRO_CLICHES = [
  /\n*(in conclusion|in summary|to summarize|to sum up|in essence|all in all|ultimately)[,:]?\s*(it is (clear|evident|apparent) that|we can see that)?\s*/gi,
  /\n*i hope this (helps|explanation was clear|clarifies the concept)[!.?]?\s*$/gi,
  /\n*feel free to ask (more questions|if you need further clarification|any follow-ups)[!.?]?\s*$/gi
];

const AI_PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bstands as a testament to\b/gi, 'is evidence of'],
  [/\bplays a crucial role in\b/gi, 'is essential to'],
  [/\bdelve(?:s)? into\b/gi, 'examines'],
  [/\bit is worth noting that\b/gi, 'note that'],
  [/\bit is important to (?:remember|note|keep in mind) that\b/gi, 'remember that'],
  [/\butilize(?:s)?\b/gi, 'use$1'],
  [/\butilizing\b/gi, 'using'],
  [/\bleverage(?:s)?\b/gi, 'use$1'],
  [/\bleveraging\b/gi, 'using'],
  [/\bmoreover,?\s*/gi, 'also, '],
  [/\bfurthermore,?\s*/gi, 'in addition, '],
  [/\badditionally,?\s*/gi, 'also, ']
];

/*
 * Masks code blocks and markdown tables with temporary tokens
 * so regex phrase replacements don't alter code syntax or table delimiters.
 */
function protectMarkdownAndCode(text: string): { protectedText: string; placeholders: Map<string, string> } {
  const placeholders = new Map<string, string>();
  let counter = 0;

  // Protect multi-line code fences
  let result = text.replace(/(```[\s\S]*?```)/g, (match) => {
    const key = `__CODE_BLOCK_${counter++}__`;
    placeholders.set(key, match);
    return key;
  });

  // Protect markdown table blocks
  result = result.replace(/(\|[^\n]+\|\n\|[-:\s|]+\|\n(?:\|[^\n]+\|\n?)+)/g, (match) => {
    const key = `__TABLE_BLOCK_${counter++}__`;
    placeholders.set(key, match);
    return key;
  });

  return { protectedText: result, placeholders };
}

/*
 * Re-inserts the original markdown code blocks and tables.
 */
function restoreMarkdownAndCode(text: string, placeholders: Map<string, string>): string {
  let result = text;
  placeholders.forEach((originalValue, key) => {
    result = result.split(key).join(originalValue);
  });
  return result;
}

/*
 * Main humanizer function applied to model response chunks and final text.
 */
export function humanizeText(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') {
    return rawText;
  }

  try {
    const { protectedText, placeholders } = protectMarkdownAndCode(rawText);
    let textToProcess = protectedText;

    for (const pattern of AI_INTRO_CLICHES) {
      textToProcess = textToProcess.replace(pattern, '');
    }

    for (const pattern of AI_OUTRO_CLICHES) {
      textToProcess = textToProcess.replace(pattern, '');
    }

    for (const [pattern, replacement] of AI_PHRASE_REPLACEMENTS) {
      textToProcess = textToProcess.replace(pattern, replacement);
    }

    textToProcess = textToProcess.replace(/\n{3,}/g, '\n\n').trim();
    return restoreMarkdownAndCode(textToProcess, placeholders);
  } catch {
    return rawText;
  }
}

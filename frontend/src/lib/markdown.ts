// Markdown renderer — markdown-it (full CommonMark + GFM) → DOMPurify-sanitized
// HTML. Handles everything a standard .md file expresses: headings (with anchor
// IDs for the TOC), bold/italic/strikethrough/inline-code, fenced code blocks,
// ordered/unordered/task lists, links (autolinked), images, blockquotes, HR,
// and GFM tables. ```mermaid fences are emitted as <pre class="mermaid"> blocks
// that the detail view turns into diagrams client-side (see useMermaid).
//
// Security model:
//   1. `html: false` — raw HTML inside the markdown source is escaped, never
//      executed. So a post author can't inject <script>/<iframe>/onerror=…
//   2. markdown-it's built-in link validator rejects javascript:/vbscript: and
//      non-image data: URLs.
//   3. The rendered HTML is passed through DOMPurify as defense-in-depth before
//      it ever reaches dangerouslySetInnerHTML.
//   4. Mermaid runs with securityLevel 'strict' (its own DOMPurify pass) on the
//      escaped source, after our sanitization.

import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import DOMPurify from 'dompurify';

// slugify — frontend-only heading anchor IDs for the in-page TOC (links to
// #id within the same rendered body). Deliberately independent of the backend
// post-slug logic, which derives a post's URL from its title.
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section';

export interface MarkdownHeading {
  level: number;
  text: string;
  id: string;
}

export interface RenderedMarkdown {
  html: string;
  headings: MarkdownHeading[];
  wordCount: number;
}

// Per-render scratch space threaded through markdown-it's `env`.
interface RenderEnv {
  headings: MarkdownHeading[];
  seenIds: Set<string>;
}

const md = new MarkdownIt({
  html: false, // never execute raw HTML from post authors
  linkify: true, // turn bare URLs into links
  typographer: true, // smart quotes / dashes
  breaks: false, // single newline = soft break (space), like CommonMark
});
// enabled:false → checkboxes render with `disabled`, i.e. static/read-only. The
// published view is read-only (no persistence), so interactive checkboxes would
// toggle visually then silently lose state on the next render.
md.use(taskLists, { enabled: false, label: true });

// Headings — inject a stable id (matching the backend slug) + the hover "#"
// anchor the TOC links to, and record the heading for the sidebar TOC.
md.renderer.rules.heading_open = (tokens, idx, options, env: RenderEnv, self) => {
  const level = Number(tokens[idx].tag.slice(1));
  // Use the heading's PLAIN text (not raw inline markdown) so the TOC label and
  // slug don't leak literal "**", backticks, or "[text](url)" fragments.
  const inline = tokens[idx + 1];
  const text = (
    (inline?.children ?? [])
      .filter((c) => c.type === 'text' || c.type === 'code_inline')
      .map((c) => c.content)
      .join('') || inline?.content || ''
  ).trim();
  const base = slugify(text);
  let id = base;
  let n = 2;
  while (env.seenIds.has(id)) id = `${base}-${n++}`;
  env.seenIds.add(id);
  env.headings.push({ level, text, id });
  tokens[idx].attrSet('id', id);
  return (
    self.renderToken(tokens, idx, options) +
    `<a class="md-anchor" href="#${id}" aria-hidden="true">#</a>`
  );
};

// Fenced code — ```mermaid becomes a diagram container; everything else keeps
// the `data-lang` attribute the CSS uses to print the language label.
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const lang = token.info.trim().split(/\s+/)[0] || '';
  const body = md.utils.escapeHtml(token.content);
  if (lang === 'mermaid') {
    return `<pre class="mermaid">${body}</pre>`;
  }
  const langAttr = lang ? ` data-lang="${md.utils.escapeHtml(lang)}"` : '';
  return `<pre${langAttr}><code>${body}</code></pre>`;
};

// External links open in a new tab; markdown-it already blocks unsafe protocols.
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || '';
  if (/^https?:\/\//i.test(href)) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noreferrer noopener');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// renderMarkdown — parse → sanitize, plus the TOC heading list + a word count
// for the reading-time estimate. Output is consumed via dangerouslySetInnerHTML
// on a `.markdown-body` wrapper styled in globals.css.
export const renderMarkdown = (src: string): RenderedMarkdown => {
  if (!src) return { html: '', headings: [], wordCount: 0 };

  const env: RenderEnv = { headings: [], seenIds: new Set() };
  const rawHtml = md.render(src, env);

  const html = DOMPurify.sanitize(rawHtml, {
    // Task-list checkboxes + our anchor/lang/target attributes.
    ADD_ATTR: ['target', 'data-lang', 'aria-hidden', 'type', 'checked', 'disabled'],
    ADD_TAGS: ['input'],
  });

  // Word count — strip code + markup cheaply for a reading-time estimate.
  const stripped = src
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/[#>*_~|\-]/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const wordCount = (stripped.trim().match(/\S+/g) || []).length;

  return { html, headings: env.headings, wordCount };
};

// readingTimeMinutes — Hashnode-style estimate (≈ 240 wpm, rounded up).
export const readingTimeMinutes = (wordCount: number): number =>
  Math.max(1, Math.ceil(wordCount / 240));

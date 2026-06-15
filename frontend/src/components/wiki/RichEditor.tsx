import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model';
import { Markdown } from 'tiptap-markdown';
import { useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, Code, Link as LinkIcon, Heading1, Heading2, Heading3,
  List as ListIcon, ListOrdered, Quote, Image as ImageIcon, Strikethrough,
} from 'lucide-react';
import { uploadWikiImage } from '../../hooks/useWiki';
import { toast } from 'sonner';

// RichEditor — Hashnode/Notion-style WYSIWYG. The user types markdown shortcuts
// (`# `, `**bold**`, `- `, etc.) and the editor renders them inline. Storage
// stays as markdown so the on-disk content + the rendered detail view don't
// need to change.
//
// Tech: TipTap (ProseMirror) with StarterKit for paragraphs/headings/lists/
// blockquote/code/inline-formatting, the Markdown extension for I/O, Link &
// Image extensions for embeds, and a Placeholder so empty docs hint authors.
//
// Editing UX:
//   * Type `# / ## / ### ` for headings, `- ` or `* ` for bullets, `1. ` for
//     ordered lists, `> ` for blockquotes, `\`\`\`` for fenced code, `**x**`
//     for bold, `*x*` for italic, `\`x\`` for inline code — all auto-rendered.
//   * Select text → bubble menu floats above with format toggles.
//   * Image button uploads to the existing /api/wiki/upload endpoint and
//     inserts the returned URL inline.

// looksLikeMarkdown — heuristic for the paste handler. ProseMirror only runs
// tiptap-markdown's text parser when the clipboard is PURE plain text; copying a
// .md from most viewers also carries text/html, so paste falls into the HTML
// path and the whole doc lands in one block. When the pasted text clearly has
// markdown structure we parse it ourselves instead.
const looksLikeMarkdown = (t: string): boolean =>
  /^#{1,6}\s/m.test(t) ||                              // ATX headings
  /^.+\n=+\s*$/m.test(t) ||                            // setext h1 (Title\n===)
  /^.+\n-{2,}\s*$/m.test(t) ||                         // setext h2 (Title\n---)
  /^\s*[-*+]\s/m.test(t) ||                            // bullet / task list
  /^\s*\d+\.\s/m.test(t) ||                            // ordered list
  /^>\s/m.test(t) ||                                   // blockquote
  /```/.test(t) ||                                     // fenced code (incl. ```mermaid)
  /^\s*\|.*\|/m.test(t) ||                             // table row with outer pipes
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/m.test(t) || // GFM delimiter row (covers pipe-less tables)
  /\[[^\]]+\]\([^)]+\)/.test(t) ||                     // links
  /\*\*[^*]+\*\*/.test(t) ||                           // bold
  /(^|\s)`[^`]+`/.test(t);                             // inline code

export const RichEditor = ({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
}) => {
  // Track the last value we wrote OUT — used to skip the controlled-prop sync
  // when the change came from us (otherwise every keystroke would round-trip
  // through onChange and re-set the editor, blowing away cursor position).
  const lastEmittedRef = useRef<string>(value);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [linkPromptOpen, setLinkPromptOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // We let Markdown handle codeBlock so the language attribute round-trips
        // ``` js ``` ↔ <pre data-lang="js"><code> correctly.
        heading: { levels: [1, 2, 3, 4] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: 'noreferrer noopener',
          target: '_blank',
        },
      }),
      Image.configure({
        HTMLAttributes: { loading: 'lazy' },
        allowBase64: false,
      }),
      // GFM tables + task lists so a pasted markdown doc round-trips them
      // instead of dropping the structure.
      TableKit.configure({ table: { resizable: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: placeholder || "Tell the story… (try '#', '-', or '**bold**')",
        emptyEditorClass: 'is-editor-empty',
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        // CommonMark semantics: a single newline is a soft break (space), NOT a
        // <br>. With breaks:true, hard-wrapped .md paragraphs become hardBreak
        // nodes that serialize back as "\"-suffixed lines, corrupting the saved
        // markdown. Keep this in sync with lib/markdown.ts (also breaks:false).
        breaks: false,
        linkify: true,
      }),
    ],
    content: value,
    // The editor is the single editing surface; class names hook our typographic
    // CSS up (markdown-body styles already exist in globals.css).
    editorProps: {
      attributes: {
        class: 'markdown-body focus:outline-none min-h-[480px] px-2 py-1',
      },
      handleKeyDown(_view, event) {
        // Cmd/Ctrl+K opens the link prompt — Notion-like.
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          setLinkDraft('');
          setLinkPromptOpen(true);
          return true;
        }
        return false;
      },
      handlePaste(_view, event) {
        const clipboard = event.clipboardData;
        if (!clipboard) return false;

        // 1. Image file on the clipboard → upload + insert (Hashnode-style).
        for (const item of Array.from(clipboard.items)) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              uploadAndInsert(file);
              return true;
            }
          }
        }

        // 2. Pasted markdown → parse it into rich blocks. We do this ourselves
        // because ProseMirror skips tiptap-markdown's text parser whenever the
        // clipboard also carries text/html (which a copied .md usually does),
        // otherwise dumping the whole document into a single code block.
        const text = clipboard.getData('text/plain');
        if (text && editor && looksLikeMarkdown(text)) {
          event.preventDefault();
          // markdown → HTML (real tags) → ProseMirror slice. We build the slice
          // ourselves (mirroring tiptap-markdown's internal clipboard parser)
          // because insertContent(htmlString) would escape the tags into text.
          const html: string = editor.storage.markdown.parser.parse(text);
          const dom = document.createElement('div');
          dom.innerHTML = html;
          // preserveWhitespace:false so a soft newline inside a paragraph (CommonMark
          // soft break) collapses to a space instead of becoming a hardBreak node —
          // otherwise hard-wrapped .md paragraphs serialize back with stray "\" line
          // breaks. Code blocks keep their whitespace via their own <pre> parse rule;
          // explicit hard breaks (<br>) are still preserved as real elements.
          const slice = ProseMirrorDOMParser.fromSchema(editor.schema).parseSlice(dom, {
            preserveWhitespace: false,
          });
          const { state, dispatch } = editor.view;
          dispatch(state.tr.replaceSelection(slice).scrollIntoView());
          return true;
        }
        return false;
      },
      handleDrop(view, event) {
        // Drag/drop image upload — same path as paste.
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const file = files[0];
        if (!file.type.startsWith('image/')) return false;
        event.preventDefault();
        // Convert the drop coordinates into an editor position so the image
        // lands where the user dropped it.
        const coords = { left: event.clientX, top: event.clientY };
        const pos = view.posAtCoords(coords)?.pos;
        uploadAndInsert(file, pos);
        return true;
      },
    },
    onUpdate({ editor }) {
      // Markdown extension surfaces the editor's content as markdown via
      // `editor.storage.markdown.getMarkdown()`. We push that string up to
      // the parent so save/cancel logic and the word count stay consistent.
      const md = editor.storage.markdown.getMarkdown();
      lastEmittedRef.current = md;
      onChange(md);
    },
  });

  // Controlled-prop sync — only re-set the editor content when the parent's
  // `value` changes from somewhere OTHER than our own onChange (e.g. hydrating
  // an existing post into a freshly-mounted editor). Skipping this would
  // recreate the document on every keystroke, wiping the cursor.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    editor.commands.setContent(value, { emitUpdate: false });
    lastEmittedRef.current = value;
  }, [editor, value]);

  // uploadAndInsert — common path for paste / drop / toolbar-button uploads.
  const uploadAndInsert = async (file: File, pos?: number) => {
    if (!editor) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image is over 5 MB — please pick a smaller one.');
      return;
    }
    try {
      const { url } = await uploadWikiImage(file);
      // setImage inserts at the current selection; if a drop pos was provided,
      // we move the selection there first.
      if (pos !== undefined) {
        editor.chain().focus().setTextSelection(pos).setImage({ src: url }).run();
      } else {
        editor.chain().focus().setImage({ src: url }).run();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      toast.error(message);
    }
  };

  const openImagePicker = () => {
    fileInputRef.current?.click();
  };
  const onPickImage: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (f) uploadAndInsert(f);
    if (e.target) e.target.value = '';
  };

  const applyLink = () => {
    if (!editor) return;
    const url = linkDraft.trim();
    setLinkPromptOpen(false);
    setLinkDraft('');
    if (!url) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(url)) {
      toast.error('URL must start with http(s):// (or mailto:, /, #)');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  if (!editor) return null;

  // Block formatting toolbar — always visible at the top of the editor.
  // Uses TipTap commands; aria-pressed reflects the active state so a screen
  // reader knows when bold is on, etc.
  const isHeading = (level: 1 | 2 | 3) => editor.isActive('heading', { level });
  const tbBtn = (active: boolean) =>
    `inline-flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
      active
        ? 'bg-[var(--accent-pink-soft)] text-[var(--accent-pink)]'
        : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-black/[0.04]'
    }`;

  return (
    <div className="bento-card p-0 overflow-hidden flex flex-col">
      {/* Persistent toolbar */}
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-1 flex-wrap bg-[var(--card-warm)]">
        <button type="button" aria-pressed={isHeading(1)} className={tbBtn(isHeading(1))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1"><Heading1 className="h-4 w-4" /></button>
        <button type="button" aria-pressed={isHeading(2)} className={tbBtn(isHeading(2))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2"><Heading2 className="h-4 w-4" /></button>
        <button type="button" aria-pressed={isHeading(3)} className={tbBtn(isHeading(3))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3"><Heading3 className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px bg-[var(--border)]" />
        <button type="button" aria-pressed={editor.isActive('bold')} className={tbBtn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)"><Bold className="h-4 w-4" /></button>
        <button type="button" aria-pressed={editor.isActive('italic')} className={tbBtn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)"><Italic className="h-4 w-4" /></button>
        <button type="button" aria-pressed={editor.isActive('strike')} className={tbBtn(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><Strikethrough className="h-4 w-4" /></button>
        <button type="button" aria-pressed={editor.isActive('code')} className={tbBtn(editor.isActive('code'))} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code"><Code className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px bg-[var(--border)]" />
        <button type="button" aria-pressed={editor.isActive('bulletList')} className={tbBtn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list"><ListIcon className="h-4 w-4" /></button>
        <button type="button" aria-pressed={editor.isActive('orderedList')} className={tbBtn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered className="h-4 w-4" /></button>
        <button type="button" aria-pressed={editor.isActive('blockquote')} className={tbBtn(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote"><Quote className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px bg-[var(--border)]" />
        <button type="button" aria-pressed={editor.isActive('link')} className={tbBtn(editor.isActive('link'))} onClick={() => { setLinkDraft(editor.getAttributes('link').href || ''); setLinkPromptOpen(true); }} title="Insert link (Ctrl+K)"><LinkIcon className="h-4 w-4" /></button>
        <button type="button" className={tbBtn(false)} onClick={openImagePicker} title="Upload image"><ImageIcon className="h-4 w-4" /></button>
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPickImage} className="hidden" />
        <span className="flex-1" />
        <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--ink-muted)] hidden sm:inline">
          Markdown shortcuts: # · ** · ` · - · &gt;
        </span>
      </div>

      {/* Bubble menu — floating selection toolbar (Hashnode/Notion style) */}
      <BubbleMenu
        editor={editor}
        options={{ placement: 'top' }}
        shouldShow={({ from, to }) => to > from}
      >
        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-[0_8px_24px_rgba(0,0,0,0.12)] px-1.5 py-1">
          <button type="button" className={tbBtn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="h-3.5 w-3.5" /></button>
          <button type="button" className={tbBtn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="h-3.5 w-3.5" /></button>
          <button type="button" className={tbBtn(editor.isActive('code'))} onClick={() => editor.chain().focus().toggleCode().run()} title="Code"><Code className="h-3.5 w-3.5" /></button>
          <button type="button" className={tbBtn(editor.isActive('link'))} onClick={() => { setLinkDraft(editor.getAttributes('link').href || ''); setLinkPromptOpen(true); }} title="Link"><LinkIcon className="h-3.5 w-3.5" /></button>
        </div>
      </BubbleMenu>

      {/* Editor surface */}
      <div className="flex-1 overflow-auto min-h-[480px] p-6">
        <EditorContent editor={editor} />
      </div>

      {/* Inline link prompt */}
      {linkPromptOpen && (
        <div className="absolute inset-0 bg-black/30 flex items-start justify-center pt-32 z-50" onClick={() => setLinkPromptOpen(false)}>
          <div className="bento-card p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)] mb-2">Link URL</label>
            <input
              type="url"
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                if (e.key === 'Escape') setLinkPromptOpen(false);
              }}
              placeholder="https://… (leave blank to remove)"
              autoFocus
              className="w-full h-10 px-3 rounded-lg bg-[var(--card-warm)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--accent-pink)]/50"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={() => setLinkPromptOpen(false)} className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] px-3 py-1.5">Cancel</button>
              <button type="button" onClick={applyLink} className="text-xs font-bold text-[var(--on-accent)] bg-[var(--accent-pink)] hover:opacity-90 rounded-md px-3 py-1.5">Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

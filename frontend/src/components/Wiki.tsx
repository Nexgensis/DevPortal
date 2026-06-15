import { useState, useMemo, useEffect, useRef, type ChangeEvent, type DragEvent } from 'react';
import {
  BookOpen, Pencil, Plus, Search, Trash2, Clock, Eye, Calendar,
  Tag as TagIcon, FolderTree, X, Save, FileText, Sparkles, List,
  ChevronRight, ChevronDown, FolderOpen, Folder, FileIcon, ArrowLeft,
  Upload, Image as ImageIcon, Link as LinkIcon, Loader2,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useWikiList, useWikiPost, useWikiMutations, uploadWikiImage } from '../hooks/useWiki';
import { toast } from 'sonner';
import { WikiPost, WikiPostInput, splitTags } from '../types/wiki';
import { renderMarkdown, readingTimeMinutes, MarkdownHeading } from '../lib/markdown';
import { useMermaid } from '../hooks/useMermaid';
import { RichEditor } from './wiki/RichEditor';
import { GlassCard } from './ui/glass-card';
import { GlassSkeleton } from './ui/glass-skeleton';
import { AccentButton } from './ui/accent-button';
import { PillTag } from './ui/pill-tag';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';

// formatRelDate — short date label for cards / meta rows ("3 days ago" / "Mar 5"
// depending on age). No external date lib.
const formatRelDate = (iso: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const ageDays = Math.floor((now - d.getTime()) / 86_400_000);
  if (ageDays < 1) return 'today';
  if (ageDays === 1) return 'yesterday';
  if (ageDays < 7) return `${ageDays} days ago`;
  if (ageDays < 30) return `${Math.floor(ageDays / 7)}w ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: ageDays > 365 ? 'numeric' : undefined });
};

const initial = (n: string): string => (n.trim()[0] || '?').toUpperCase();

// Deterministic palette for cover gradients when a post has no cover image.
const COVER_GRADIENTS = [
  'linear-gradient(135deg, #5B4DFF 0%, #8B7CFF 100%)',
  'linear-gradient(135deg, #FF5A5F 0%, #FF8A65 100%)',
  'linear-gradient(135deg, #10B981 0%, #34D399 100%)',
  'linear-gradient(135deg, #4285F4 0%, #6FA8FF 100%)',
  'linear-gradient(135deg, #6D28D9 0%, #A04EF6 100%)',
  'linear-gradient(135deg, #0F9D9D 0%, #3ECECE 100%)',
  'linear-gradient(135deg, #EA4335 0%, #FF6B35 100%)',
  'linear-gradient(135deg, #FBBC05 0%, #FFD75A 100%)',
];
const hashIndex = (s: string, mod: number): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_003;
  return Math.abs(h) % mod;
};

// ---------------------------------------------------------------------------
// Folder tree — categories are slash-delimited paths ("WebManager/backend/auth"),
// so a post's category describes the full folder chain it lives in. We build a
// nested tree of arbitrary depth from those paths. A folder can hold both
// sub-folders and posts at the same level.
// ---------------------------------------------------------------------------
export interface WikiTreeNode {
  name: string;                       // this segment's label ("backend")
  path: string;                       // full path from root ("WebManager/backend")
  children: Map<string, WikiTreeNode>;
  posts: WikiPost[];                  // posts that live directly in this folder
}

// Split a category string into clean folder segments. Empty / missing categories
// land everything under a single "General" root so nothing is orphaned.
const folderSegments = (category: string): string[] => {
  const segs = (category || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  return segs.length ? segs : ['General'];
};

const newNode = (name: string, path: string): WikiTreeNode => ({
  name, path, children: new Map(), posts: [],
});

// buildFolderTree — fold the flat post list into a nested tree keyed by path.
const buildFolderTree = (posts: WikiPost[]): WikiTreeNode => {
  const root = newNode('', '');
  for (const p of posts) {
    let node = root;
    let acc = '';
    for (const seg of folderSegments(p.category)) {
      acc = acc ? `${acc}/${seg}` : seg;
      let child = node.children.get(seg);
      if (!child) { child = newNode(seg, acc); node.children.set(seg, child); }
      node = child;
    }
    node.posts.push(p);
  }
  return root;
};

// Total posts in a subtree (folder badge count) — own posts plus all descendants.
const subtreePostCount = (node: WikiTreeNode): number => {
  let n = node.posts.length;
  for (const child of node.children.values()) n += subtreePostCount(child);
  return n;
};

// Child folders sorted alphabetically, with "Onboarding" pinned first so new
// devs land on the right docs. Mirrors the old top-level ordering, now per-level.
const sortedChildFolders = (node: WikiTreeNode): WikiTreeNode[] =>
  Array.from(node.children.values()).sort((a, b) => {
    if (a.name.toLowerCase() === 'onboarding') return -1;
    if (b.name.toLowerCase() === 'onboarding') return 1;
    return a.name.localeCompare(b.name);
  });

// Posts within a folder, most-recent-first so live editing surfaces fresh.
const sortedFolderPosts = (node: WikiTreeNode): WikiPost[] =>
  [...node.posts].sort((a, b) => {
    const ad = new Date(a.publishedAt || a.createdAt).getTime();
    const bd = new Date(b.publishedAt || b.createdAt).getTime();
    return bd - ad;
  });

// Top-level Wiki container — two modes:
//   * browse: docs-style layout, sidebar (folder tree) + main (feed or detail)
//   * editor: fullwidth markdown editor (no sidebar)
// Inside browse, `selectedSlug` toggles between the feed (latest posts) and the
// detail view of a single post — sidebar stays mounted the whole time so
// switching posts feels instant.
type Mode =
  | { kind: 'browse'; selectedSlug: string | null }
  | { kind: 'editor'; postId: string | null };

export const Wiki = () => {
  const { user, isAdmin } = useAuth();
  const [mode, setMode] = useState<Mode>({ kind: 'browse', selectedSlug: null });

  const openPost = (slug: string) => setMode({ kind: 'browse', selectedSlug: slug });
  const showFeed = () => setMode({ kind: 'browse', selectedSlug: null });
  const openEditor = (postId: string | null) => setMode({ kind: 'editor', postId });

  if (mode.kind === 'editor') {
    return (
      <WikiEditor
        postId={mode.postId}
        onCancel={() => setMode({ kind: 'browse', selectedSlug: null })}
        onSaved={(post) => openPost(post.slug)}
      />
    );
  }

  return (
    <WikiBrowse
      selectedSlug={mode.selectedSlug}
      onSelectPost={openPost}
      onShowFeed={showFeed}
      onNewPost={() => openEditor(null)}
      onEditPost={(id) => openEditor(id)}
      currentUsername={user?.username ?? ''}
      isAdmin={isAdmin}
    />
  );
};

// =============================================================================
// BROWSE — docs-style shell. Left sidebar (folder tree) + main area (feed/detail)
// =============================================================================

const WikiBrowse = ({
  selectedSlug, onSelectPost, onShowFeed, onNewPost, onEditPost, currentUsername, isAdmin,
}: {
  selectedSlug: string | null;
  onSelectPost: (slug: string) => void;
  onShowFeed: () => void;
  onNewPost: () => void;
  onEditPost: (id: string) => void;
  currentUsername: string;
  isAdmin: boolean;
}) => {
  const { posts, loading } = useWikiList();
  const [sidebarOpen, setSidebarOpen] = useState(true); // collapsible on small screens

  return (
    <div className="flex gap-6 min-h-[calc(100vh-280px)]">
      {/* Sidebar */}
      <WikiSidebar
        posts={posts}
        loading={loading}
        selectedSlug={selectedSlug}
        onSelectPost={onSelectPost}
        onShowFeed={onShowFeed}
        onNewPost={onNewPost}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      {/* Main area */}
      <main className="flex-1 min-w-0">
        {selectedSlug ? (
          <WikiPostBody
            slug={selectedSlug}
            onEdit={onEditPost}
            onBack={onShowFeed}
            currentUsername={currentUsername}
            isAdmin={isAdmin}
          />
        ) : (
          <WikiFeed posts={posts} loading={loading} onOpen={onSelectPost} />
        )}
      </main>
    </div>
  );
};

// =============================================================================
// SIDEBAR — folder tree grouped by category
// =============================================================================

const WikiSidebar = ({
  posts, loading, selectedSlug, onSelectPost, onShowFeed, onNewPost, open, onToggle,
}: {
  posts: WikiPost[];
  loading: boolean;
  selectedSlug: string | null;
  onSelectPost: (slug: string) => void;
  onShowFeed: () => void;
  onNewPost: () => void;
  open: boolean;
  onToggle: () => void;
}) => {
  const [search, setSearch] = useState('');

  // Filter, then fold into a nested folder tree. Categories are slash-delimited
  // paths, so "WebManager/backend/auth" nests three folders deep. A folder can
  // hold both sub-folders and posts. Search filters posts before the tree is
  // built, so folders with no matching posts simply never appear.
  const tree = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? posts.filter((p) =>
          p.title.toLowerCase().includes(q) ||
          p.tags.toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q),
        )
      : posts;
    return buildFolderTree(filtered);
  }, [posts, search]);
  const topFolders = sortedChildFolders(tree);

  // Expanded-folder state — by default expand everything (better discoverability)
  // and persist user collapses so a returning visitor's tree stays the way they left it.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('wiki-sidebar-collapsed');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const toggleGroup = (cat: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      try { localStorage.setItem('wiki-sidebar-collapsed', JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
  };

  // When the user searches, auto-expand every group so matches are visible.
  const searching = search.trim().length > 0;

  if (!open) {
    return (
      <aside className="shrink-0">
        <button
          onClick={onToggle}
          aria-label="Open sidebar"
          className="h-10 w-10 rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:border-[var(--accent-pink)]/40 flex items-center justify-center transition-colors"
          title="Show docs tree"
        >
          <BookOpen className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-72 shrink-0">
      <div className="bento-card p-0 sticky top-4 overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {/* Sidebar header — "Docs" label + collapse + new-post button */}
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-2 bg-[var(--card-warm)]">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="h-4 w-4 text-[var(--accent-pink)] shrink-0" />
            <span className="font-display text-sm font-bold text-[var(--ink)] truncate">Documentation</span>
          </div>
          <button
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="h-7 w-7 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-black/[0.04] flex items-center justify-center transition-colors"
            title="Hide tree"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-[var(--border)]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-muted)] pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search docs…"
              className="w-full h-9 pl-8 pr-3 rounded-lg bg-[var(--card-warm)] border border-[var(--border)] text-xs text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--accent-pink)]/40"
            />
          </div>
        </div>

        {/* "All / Latest" pseudo-folder — clears selection and shows the feed. */}
        <button
          onClick={onShowFeed}
          className={`mx-3 mt-3 flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left transition-colors ${
            selectedSlug === null
              ? 'bg-[var(--accent-pink-soft)] text-[var(--ink)] font-semibold'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-black/[0.03]'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          Latest posts
        </button>

        {/* Folder tree — scrollable */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="space-y-2">
              <GlassSkeleton className="h-8" />
              <GlassSkeleton className="h-8" />
              <GlassSkeleton className="h-8" />
            </div>
          ) : topFolders.length === 0 ? (
            <p className="text-xs text-[var(--ink-muted)] italic px-2 py-4 text-center">
              {searching ? `No matches for "${search}".` : 'No posts yet.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {topFolders.map((node) => (
                <WikiFolderNode
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedSlug={selectedSlug}
                  onSelectPost={onSelectPost}
                  collapsed={collapsed}
                  onToggle={toggleGroup}
                  searching={searching}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Sidebar footer — new-post CTA (anyone can author) */}
        <div className="p-3 border-t border-[var(--border)] bg-[var(--card-warm)]">
          <button
            onClick={onNewPost}
            className="w-full inline-flex items-center justify-center gap-2 h-9 rounded-lg bg-[var(--accent-pink)] text-[var(--on-accent)] text-xs font-bold hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" />
            New post
          </button>
        </div>
      </div>
    </aside>
  );
};

// WikiFolderNode — one folder in the recursive tree. Renders its own header
// (chevron + folder icon + name + recursive post count), then, when expanded,
// its child folders (recursing) followed by the posts that live directly in it.
// Indentation comes from the nested <ul> border, so depth reads naturally.
const WikiFolderNode = ({
  node, depth, selectedSlug, onSelectPost, collapsed, onToggle, searching,
}: {
  node: WikiTreeNode;
  depth: number;
  selectedSlug: string | null;
  onSelectPost: (slug: string) => void;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  searching: boolean;
}) => {
  const isCollapsed = !searching && collapsed.has(node.path);
  const childFolders = sortedChildFolders(node);
  const folderPosts = sortedFolderPosts(node);

  return (
    <li>
      <button
        onClick={() => onToggle(node.path)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left text-[var(--ink)] hover:bg-black/[0.03] transition-colors group"
      >
        {isCollapsed
          ? <ChevronRight className="h-3 w-3 text-[var(--ink-muted)] shrink-0" />
          : <ChevronDown className="h-3 w-3 text-[var(--ink-muted)] shrink-0" />}
        {isCollapsed
          ? <Folder className="h-3.5 w-3.5 text-[var(--accent-pink)] shrink-0" />
          : <FolderOpen className="h-3.5 w-3.5 text-[var(--accent-pink)] shrink-0" />}
        <span className={`truncate flex-1 ${depth === 0 ? 'text-xs font-bold uppercase tracking-wider' : 'text-xs font-semibold'}`}>
          {node.name}
        </span>
        <span className="text-[10px] tabular-nums text-[var(--ink-muted)] shrink-0 px-1.5 py-0.5 rounded-full bg-black/[0.04] group-hover:bg-black/[0.08]">
          {subtreePostCount(node)}
        </span>
      </button>
      {!isCollapsed && (childFolders.length > 0 || folderPosts.length > 0) && (
        <ul className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--border)] pl-2">
          {childFolders.map((child) => (
            <WikiFolderNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedSlug={selectedSlug}
              onSelectPost={onSelectPost}
              collapsed={collapsed}
              onToggle={onToggle}
              searching={searching}
            />
          ))}
          {folderPosts.map((p) => {
            const isSelected = p.slug === selectedSlug;
            return (
              <li key={p.id}>
                <button
                  onClick={() => onSelectPost(p.slug)}
                  className={`w-full flex items-start gap-1.5 px-2 py-1.5 rounded-md text-left text-xs transition-colors leading-snug ${
                    isSelected
                      ? 'bg-[var(--accent-pink-soft)] text-[var(--ink)] font-semibold border-l-2 border-[var(--accent-pink)] -ml-[2px] pl-[7px]'
                      : 'text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-black/[0.03]'
                  }`}
                  title={p.title}
                >
                  <FileIcon className="h-3 w-3 shrink-0 mt-0.5" />
                  <span className="line-clamp-2 flex-1">
                    {p.title}
                    {!p.published && <span className="ml-1 text-[10px] text-[var(--accent-peach)]">(draft)</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
};

// =============================================================================
// FEED — what the main area shows when no post is selected
// =============================================================================

const WikiFeed = ({ posts, loading, onOpen }: { posts: WikiPost[]; loading: boolean; onOpen: (slug: string) => void }) => {
  // Featured = newest published post; rest go into the responsive grid.
  const featured = posts[0] || null;
  const rest = posts.slice(1);

  if (loading) {
    return (
      <div className="space-y-6">
        <GlassSkeleton className="h-64 rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          <GlassSkeleton.Card count={6} className="h-72" />
        </div>
      </div>
    );
  }
  if (posts.length === 0) {
    return (
      <GlassCard className="p-0">
        <div className="text-center py-24 px-4">
          <BookOpen className="h-14 w-14 text-[var(--ink-muted)] mx-auto mb-5" strokeWidth={1.4} />
          <h3 className="mb-2 text-lg font-semibold text-[var(--ink)]">No posts yet</h3>
          <p className="text-[var(--ink-muted)] text-sm max-w-md mx-auto">
            Start the developer knowledge base — click <strong>New post</strong> in the sidebar.
          </p>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-8">
      {featured && <FeaturedCard post={featured} onClick={() => onOpen(featured.slug)} />}

      {rest.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-display text-xl font-bold text-[var(--ink)]">More posts</h3>
            <span className="text-xs text-[var(--ink-muted)]">
              {rest.length} post{rest.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {rest.map((p) => (
              <PostCard key={p.id} post={p} onClick={() => onOpen(p.slug)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// FeaturedCard — large hero card for the newest post.
const FeaturedCard = ({ post, onClick }: { post: WikiPost; onClick: () => void }) => {
  const tags = splitTags(post.tags).slice(0, 3);
  const gradient = post.coverImage ? null : COVER_GRADIENTS[hashIndex(post.slug, COVER_GRADIENTS.length)];
  return (
    <button
      type="button"
      onClick={onClick}
      className="bento-card lift-shadow group block w-full text-left p-0 overflow-hidden hover:-translate-y-0.5 hover:shadow-[0_18px_38px_rgba(91,77,255,0.10)] focus:outline-none focus-visible:outline-none"
    >
      <div className="grid md:grid-cols-2 gap-0">
        <div
          className="relative aspect-[16/10] md:aspect-auto md:min-h-[280px] overflow-hidden"
          style={post.coverImage ? undefined : { background: gradient || undefined }}
        >
          {post.coverImage ? (
            <img src={post.coverImage} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="absolute inset-0 flex items-end p-6 text-white/90">
              <div className="font-display text-2xl font-bold line-clamp-3 drop-shadow">{post.title}</div>
            </div>
          )}
          {!post.published && (
            <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-sm px-2.5 py-1 text-[11px] font-bold text-white">
              Draft
            </span>
          )}
        </div>

        <div className="p-7 flex flex-col justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 mb-3">
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent-pink)]" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-pink)]">Latest</span>
            </div>
            <h2 className="font-display text-2xl md:text-3xl font-bold tracking-tight text-[var(--ink)] mb-3 leading-tight group-hover:text-[var(--accent-pink)] transition-colors">
              {post.title}
            </h2>
            <p className="text-[var(--ink-muted)] text-sm leading-relaxed line-clamp-3">{post.excerpt}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((t) => (
              <PillTag key={t} tone="purple" size="sm">{t}</PillTag>
            ))}
          </div>
          <PostMeta post={post} />
        </div>
      </div>
    </button>
  );
};

const PostCard = ({ post, onClick }: { post: WikiPost; onClick: () => void }) => {
  const tags = splitTags(post.tags).slice(0, 2);
  const gradient = post.coverImage ? null : COVER_GRADIENTS[hashIndex(post.slug, COVER_GRADIENTS.length)];
  return (
    <button
      type="button"
      onClick={onClick}
      className="bento-card lift group block text-left p-0 h-full flex flex-col hover:-translate-y-0.5 focus:outline-none focus-visible:outline-none"
    >
      <div
        className="relative aspect-[16/9] overflow-hidden rounded-t-[0.875rem] flex-shrink-0"
        style={post.coverImage ? undefined : { background: gradient || undefined }}
      >
        {post.coverImage ? (
          <img src={post.coverImage} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="absolute inset-0 flex items-end p-4 text-white/95">
            <div className="font-display text-lg font-bold line-clamp-3 drop-shadow">{post.title}</div>
          </div>
        )}
        {!post.published && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-bold text-white">
            Draft
          </span>
        )}
      </div>

      <div className="p-5 flex-1 flex flex-col gap-3">
        <h3 className="font-display text-lg font-bold tracking-tight text-[var(--ink)] leading-snug line-clamp-2 group-hover:text-[var(--accent-pink)] transition-colors">
          {post.title}
        </h3>
        <p className="text-sm text-[var(--ink-muted)] line-clamp-3 flex-1">{post.excerpt}</p>
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((t) => (
              <PillTag key={t} tone="purple" size="sm">{t}</PillTag>
            ))}
          </div>
        )}
        <PostMeta post={post} compact />
      </div>
    </button>
  );
};

const PostMeta = ({ post, compact }: { post: WikiPost; compact?: boolean }) => {
  const reading = readingTimeMinutes((post.excerpt || '').split(/\s+/).length * 4);
  const dateStr = formatRelDate(post.publishedAt || post.createdAt);
  return (
    <div className={`flex items-center gap-2.5 ${compact ? 'text-xs' : 'text-sm'} text-[var(--ink-muted)] pt-2`}>
      <div className="flex items-center gap-2 min-w-0">
        <div
          className={`shrink-0 rounded-full bg-[var(--accent-pink)] text-[var(--on-accent)] flex items-center justify-center font-bold ${compact ? 'h-6 w-6 text-[11px]' : 'h-7 w-7 text-[12px]'}`}
        >
          {initial(post.authorName)}
        </div>
        <span className="truncate text-[var(--ink)] font-medium">{post.authorName}</span>
      </div>
      <span aria-hidden>·</span>
      <span className="inline-flex items-center gap-1 shrink-0">
        <Clock className="h-3 w-3" /> {reading} min
      </span>
      {dateStr && (
        <>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 shrink-0">
            <Calendar className="h-3 w-3" /> {dateStr}
          </span>
        </>
      )}
      {post.viewCount > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 shrink-0">
            <Eye className="h-3 w-3" /> {post.viewCount}
          </span>
        </>
      )}
    </div>
  );
};

// =============================================================================
// DETAIL BODY — main area when a post is selected (sidebar stays mounted)
// =============================================================================

const WikiPostBody = ({
  slug, onEdit, onBack, currentUsername, isAdmin,
}: {
  slug: string;
  onEdit: (id: string) => void;
  onBack: () => void;
  currentUsername: string;
  isAdmin: boolean;
}) => {
  const { post, loading, error } = useWikiPost(slug);
  const { deletePost, saving } = useWikiMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const rendered = useMemo(() => renderMarkdown(post?.content || ''), [post?.content]);
  const bodyRef = useRef<HTMLDivElement>(null);
  useMermaid(bodyRef, rendered.html);
  const canEdit = post && (isAdmin || post.authorName === currentUsername);
  const tags = post ? splitTags(post.tags) : [];

  const handleDelete = async () => {
    if (!post) return;
    const ok = await deletePost(post.id);
    if (ok) onBack();
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <GlassSkeleton className="h-72 rounded-2xl" />
        <GlassSkeleton className="h-8 w-3/4 rounded-lg" />
        <GlassSkeleton className="h-4 w-full rounded-md" />
        <GlassSkeleton className="h-4 w-5/6 rounded-md" />
      </div>
    );
  }
  if (error || !post) {
    return (
      <GlassCard>
        <div className="text-center py-16">
          <FileText className="h-14 w-14 text-[var(--ink-muted)] mx-auto mb-4" />
          <h3 className="mb-2 text-lg font-semibold text-[var(--ink)]">Post not found</h3>
          <p className="text-[var(--ink-muted)] text-sm mb-6">{error || 'This post may have been removed.'}</p>
          <AccentButton variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Back to latest
          </AccentButton>
        </div>
      </GlassCard>
    );
  }

  const gradient = post.coverImage ? null : COVER_GRADIENTS[hashIndex(post.slug, COVER_GRADIENTS.length)];

  return (
    <div className="space-y-6">
      {/* Compact action strip — no "back" button needed since the sidebar is always there */}
      {canEdit && (
        <div className="flex items-center justify-end gap-2">
          <AccentButton variant="ghost" onClick={() => onEdit(post.id)}>
            <Pencil className="h-4 w-4" />
            Edit
          </AccentButton>
          <AccentButton variant="destructive" onClick={() => setConfirmDelete(true)} disabled={saving}>
            <Trash2 className="h-4 w-4" />
            Delete
          </AccentButton>
        </div>
      )}

      {/* Cover hero */}
      <div
        className="relative w-full aspect-[3/1] min-h-[160px] max-h-[360px] rounded-3xl overflow-hidden border border-[var(--border)]"
        style={post.coverImage ? undefined : { background: gradient || undefined }}
      >
        {post.coverImage ? (
          <img src={post.coverImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : null}
        {!post.published && (
          <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur-sm px-3 py-1.5 text-xs font-bold text-white">
            Draft — only visible to you and admins
          </span>
        )}
      </div>

      <div className="flex flex-col xl:flex-row gap-10">
        {/* Body column */}
        <article className="flex-1 min-w-0">
          {post.category && (
            <div className="inline-flex items-center gap-1.5 mb-4">
              <FolderTree className="h-3.5 w-3.5 text-[var(--accent-pink)]" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-pink)]">{post.category}</span>
            </div>
          )}
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-[var(--ink)] leading-[1.1] mb-6">
            {post.title}
          </h1>

          {/* Author + meta strip */}
          <div className="flex flex-wrap items-center gap-4 mb-8 pb-6 border-b border-[var(--border)]">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-full bg-[var(--accent-pink)] text-[var(--on-accent)] flex items-center justify-center font-bold text-base">
                {initial(post.authorName)}
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-[var(--ink)]">{post.authorName || 'Anonymous'}</div>
                <div className="text-xs text-[var(--ink-muted)]">{formatRelDate(post.publishedAt || post.createdAt)}</div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-[var(--ink-muted)]">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> {readingTimeMinutes(rendered.wordCount)} min read
              </span>
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" /> {post.viewCount} view{post.viewCount === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {/* Markdown body — see lib/markdown.ts for the safe-html contract. */}
          <div ref={bodyRef} className="markdown-body" dangerouslySetInnerHTML={{ __html: rendered.html }} />

          {tags.length > 0 && (
            <div className="mt-10 pt-6 border-t border-[var(--border)]">
              <div className="flex items-center gap-2 flex-wrap">
                <TagIcon className="h-4 w-4 text-[var(--ink-muted)] shrink-0" />
                {tags.map((t) => (
                  <PillTag key={t} tone="purple" size="sm">{t}</PillTag>
                ))}
              </div>
            </div>
          )}
        </article>

        {/* Right TOC — only renders for multi-heading posts on wide screens. */}
        {rendered.headings.length > 1 && (
          <aside className="hidden xl:block w-56 shrink-0">
            <div className="sticky top-6">
              <div className="inline-flex items-center gap-1.5 mb-3">
                <List className="h-3.5 w-3.5 text-[var(--ink-muted)]" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">On this page</span>
              </div>
              <TOC headings={rendered.headings} />
            </div>
          </aside>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              "{post.title}" will be removed from the wiki. This action can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-[var(--accent-destructive)] text-white hover:opacity-90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const TOC = ({ headings }: { headings: MarkdownHeading[] }) => {
  const items = headings.filter((h) => h.level >= 2 && h.level <= 4);
  if (items.length === 0) return null;
  return (
    <nav className="flex flex-col gap-1.5 text-sm border-l border-[var(--border)] pl-4">
      {items.map((h, idx) => (
        <a
          key={`${h.id}-${idx}`}
          href={`#${h.id}`}
          onClick={(e) => {
            e.preventDefault();
            const target = document.getElementById(h.id);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          className="text-[var(--ink-muted)] hover:text-[var(--accent-pink)] transition-colors truncate"
          style={{ paddingLeft: `${(h.level - 2) * 0.9}rem` }}
          title={h.text}
        >
          {h.text}
        </a>
      ))}
    </nav>
  );
};

// =============================================================================
// COVER IMAGE INPUT — drag/drop + click-to-upload + URL paste fallback
// =============================================================================

// CoverImageInput is the cover-image picker used by the editor. Supports three
// input paths so authors can pick whichever is easiest:
//   1. Click the dropzone → native file picker
//   2. Drag a file from the OS onto the dropzone
//   3. Paste an https URL into the URL field
// Once a value is set (either an uploaded URL or a pasted external URL), the
// component renders an aspect-ratio preview with a "Remove" / "Replace" affordance.
const CoverImageInput = ({
  value, onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');

  // Upload accepts a single File from the picker or drop event. Validates type
  // locally to give immediate feedback; the server re-checks anyway.
  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('That doesn\'t look like an image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image is over 5 MB — please pick a smaller one.');
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      // We can't surface real progress without XHR; the indeterminate state is
      // enough for sub-second uploads on a typical 1–2 MB cover.
      const result = await uploadWikiImage(file);
      onChange(result.url);
      toast.success('Cover image uploaded');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      toast.error(message);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) upload(f);
    // Reset so the same file can be re-selected after a remove.
    if (e.target) e.target.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) upload(f);
  };

  const onPasteURL = () => {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error('URL must start with http(s)://');
      return;
    }
    onChange(trimmed);
    setUrlDraft('');
    setUrlMode(false);
    toast.success('Cover URL set');
  };

  // Filled state — render a preview with action buttons overlaid.
  if (value) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--card-warm)]">
        <img
          src={value}
          alt="Cover preview"
          className="w-full aspect-[16/8] object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-white/85 font-mono truncate" title={value}>
            {value.length > 60 ? value.slice(0, 28) + '…' + value.slice(-28) : value}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-md bg-white/90 hover:bg-white text-[11px] font-semibold text-[#1A1A1E] px-2 py-1 transition-colors"
              disabled={uploading}
            >
              <Upload className="h-3 w-3" /> Replace
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-destructive)]/90 hover:bg-[var(--accent-destructive)] text-[11px] font-semibold text-white px-2 py-1 transition-colors"
              disabled={uploading}
            >
              <X className="h-3 w-3" /> Remove
            </button>
          </div>
        </div>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onPick} className="hidden" />
      </div>
    );
  }

  // Empty state — dropzone + URL toggle.
  return (
    <div>
      {!urlMode ? (
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          className={`group relative rounded-xl border-2 border-dashed cursor-pointer transition-[border-color,background-color] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] px-4 py-6 flex flex-col items-center justify-center gap-2 text-center ${
            dragOver
              ? 'border-[var(--accent-pink)] bg-[var(--accent-pink-soft)]'
              : 'border-[var(--border)] bg-[var(--card-warm)] hover:border-[var(--accent-pink)]/50 hover:bg-[var(--accent-pink-soft)]/40'
          } ${uploading ? 'pointer-events-none opacity-70' : ''}`}
        >
          {uploading ? (
            <>
              <Loader2 className="h-6 w-6 text-[var(--accent-pink)] animate-spin" />
              <span className="text-xs text-[var(--ink-muted)] font-medium">
                Uploading{progress !== null ? ` ${progress}%` : '…'}
              </span>
            </>
          ) : (
            <>
              <div className="h-10 w-10 rounded-full bg-[var(--accent-pink-soft)] flex items-center justify-center group-hover:bg-[var(--accent-pink)] transition-colors">
                <ImageIcon className="h-5 w-5 text-[var(--accent-pink)] group-hover:text-[var(--on-accent)] transition-colors" />
              </div>
              <div className="text-sm text-[var(--ink)]">
                <span className="font-semibold">Click to upload</span>
                <span className="text-[var(--ink-muted)]"> or drag an image here</span>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)] font-bold">
                JPG · PNG · WebP · GIF · max 5 MB
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setUrlMode(true); }}
                className="text-[11px] text-[var(--accent-pink)] hover:underline mt-1 inline-flex items-center gap-1"
              >
                <LinkIcon className="h-3 w-3" /> Or paste an image URL instead
              </button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={onPick}
            className="hidden"
          />
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card-warm)] p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <LinkIcon className="h-3.5 w-3.5 text-[var(--ink-muted)] shrink-0" />
            <input
              type="url"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onPasteURL(); } }}
              placeholder="https://example.com/cover.jpg"
              autoFocus
              className="flex-1 h-9 px-3 rounded-lg bg-[var(--card)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--accent-pink)]/50"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => { setUrlMode(false); setUrlDraft(''); }}
              className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
            >
              ← Back to upload
            </button>
            <button
              type="button"
              onClick={onPasteURL}
              disabled={!urlDraft.trim()}
              className="text-[11px] font-bold text-[var(--on-accent)] bg-[var(--accent-pink)] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded-md px-3 py-1.5 transition-opacity"
            >
              Set URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// EDITOR — fullwidth, no sidebar
// =============================================================================

const WikiEditor = ({
  postId, onCancel, onSaved,
}: {
  postId: string | null;
  onCancel: () => void;
  onSaved: (post: WikiPost) => void;
}) => {
  const isNew = postId === null;
  const { post: existing, loading: existingLoading } = useWikiPost(postId);
  const { createPost, updatePost, saving } = useWikiMutations();
  const { posts: allPosts } = useWikiList();

  // Existing folder paths (every prefix of every post's path) so the author can
  // autocomplete into an existing folder or extend one with a new sub-folder.
  const folderSuggestions = useMemo(() => {
    const set = new Set<string>();
    for (const p of allPosts) {
      let acc = '';
      for (const seg of folderSegments(p.category)) {
        acc = acc ? `${acc}/${seg}` : seg;
        set.add(acc);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allPosts]);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [content, setContent] = useState('');
  const [published, setPublished] = useState(true);

  const hydrated = useRef(false);
  useEffect(() => {
    if (isNew) {
      hydrated.current = true;
      return;
    }
    if (existing && !hydrated.current) {
      setTitle(existing.title);
      setSlug(existing.slug);
      setCategory(existing.category);
      setTags(existing.tags);
      setCoverImage(existing.coverImage);
      setExcerpt(existing.excerpt);
      setContent(existing.content);
      setPublished(existing.published);
      hydrated.current = true;
    }
  }, [existing, isNew]);

  const rendered = useMemo(() => renderMarkdown(content), [content]);

  const save = async () => {
    if (!title.trim() || !content.trim()) return;
    const payload: WikiPostInput = {
      title: title.trim(),
      slug: slug.trim() || undefined,
      excerpt: excerpt.trim() || undefined,
      content,
      coverImage: coverImage.trim() || undefined,
      tags: tags.trim() || undefined,
      // Normalize the folder path: trim each segment, drop empties so
      // "WebManager / backend/ " becomes a clean "WebManager/backend". Blank → undefined.
      category: category.split('/').map((s) => s.trim()).filter(Boolean).join('/') || undefined,
      published,
    };
    const saved = isNew ? await createPost(payload) : (postId ? await updatePost(postId, payload) : null);
    if (saved) onSaved(saved);
  };

  if (!isNew && existingLoading && !hydrated.current) {
    return (
      <div className="space-y-4">
        <GlassSkeleton className="h-10 w-32 rounded-full" />
        <GlassSkeleton className="h-12 rounded-lg" />
        <GlassSkeleton className="h-96 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <AccentButton variant="ghost" onClick={onCancel}>
          <X className="h-4 w-4" />
          Cancel
        </AccentButton>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-[var(--ink)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              className="h-4 w-4 rounded accent-[var(--accent-pink)]"
            />
            Publish (uncheck to save as draft)
          </label>
          <AccentButton
            variant="pink"
            onClick={save}
            disabled={saving || !title.trim() || !content.trim()}
          >
            <Save className="h-4 w-4" />
            {isNew ? 'Publish' : 'Save changes'}
          </AccentButton>
        </div>
      </div>

      <div className="bento-card p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)] mb-1.5">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Your post title…"
            className="w-full h-12 px-4 rounded-lg bg-[var(--card-warm)] border border-[var(--border)] font-display text-xl font-bold text-[var(--ink)] placeholder:text-[var(--ink-muted)]/60 focus:outline-none focus:border-[var(--accent-pink)]/50"
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)] mb-1.5">Folder path</label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="wiki-folder-paths"
            placeholder="WebManager/backend/auth"
            className="w-full h-10 px-3 rounded-lg bg-[var(--card-warm)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--accent-pink)]/50"
          />
          <datalist id="wiki-folder-paths">
            {folderSuggestions.map((path) => <option key={path} value={path} />)}
          </datalist>
          <p className="mt-1 text-[11px] text-[var(--ink-muted)] leading-snug">
            Use <span className="font-semibold text-[var(--ink)]">/</span> to nest sub-folders — e.g.{' '}
            <span className="font-mono text-[var(--accent-pink)]">WebManager/backend/auth</span>. Pick an
            existing folder from the list or type a new path. Blank lands the post under “General”.
          </p>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)] mb-1.5">Tags (comma-separated)</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="docker, postgres, ci"
            className="w-full h-10 px-3 rounded-lg bg-[var(--card-warm)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--accent-pink)]/50"
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)] mb-1.5">Slug (optional)</label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="auto from title"
            className="w-full h-10 px-3 rounded-lg bg-[var(--card-warm)] border border-[var(--border)] font-mono text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--accent-pink)]/50"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)] mb-1.5">Cover image (optional)</label>
          <CoverImageInput value={coverImage} onChange={setCoverImage} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)] mb-1.5">Excerpt (optional — auto-generated when blank)</label>
          <textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            rows={2}
            placeholder="A one or two sentence teaser for the card list."
            className="w-full px-3 py-2 rounded-lg bg-[var(--card-warm)] border border-[var(--border)] text-sm text-[var(--ink)] focus:outline-none focus:border-[var(--accent-pink)]/50 resize-none"
          />
        </div>
      </div>

      {/* WYSIWYG editor — renders headings/bold/lists inline as you type, the
          same as Hashnode / Notion. Storage stays as markdown so the post
          detail view doesn't change. Stats strip below the editor shows live
          word count + reading time so authors get the same feedback the old
          split-pane gave. */}
      <div className="space-y-2">
        <RichEditor value={content} onChange={setContent} />
        <div className="flex items-center justify-end gap-4 text-[11px] text-[var(--ink-muted)] tabular-nums px-1">
          <span>{rendered.wordCount} words</span>
          <span aria-hidden>·</span>
          <span>{readingTimeMinutes(rendered.wordCount)} min read</span>
        </div>
      </div>
    </div>
  );
};

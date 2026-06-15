import { useCallback, useEffect, useState } from 'react';
import { WikiPost, WikiPostInput } from '../types/wiki';
import { toast } from 'sonner';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

const authHeaders = (): HeadersInit => {
  const auth = localStorage.getItem('devops-dashboard-auth');
  let token: string | null = null;
  if (auth) {
    try { token = JSON.parse(auth).token; } catch { /* ignore */ }
  }
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
};

// useWikiList — fetches the post index (without bulky content). Auto-reloads
// when the supplied filter values change.
export function useWikiList(opts: { category?: string; tag?: string } = {}) {
  const [posts, setPosts] = useState<WikiPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (opts.category) qs.set('category', opts.category);
      if (opts.tag) qs.set('tag', opts.tag);
      const res = await fetch(`${API_BASE}/wiki?${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load posts (HTTP ${res.status})`);
      const data = await res.json();
      setPosts(data.posts || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load posts';
      setError(message);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [opts.category, opts.tag]);

  useEffect(() => { reload(); }, [reload]);

  return { posts, loading, error, reload };
}

// useWikiPost — fetches one post in full (with markdown content). Re-fetches
// when `key` (slug or id) changes. Returns null while loading or on error.
export function useWikiPost(key: string | null) {
  const [post, setPost] = useState<WikiPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setPost(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/wiki/${encodeURIComponent(key)}`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load post (HTTP ${res.status})`);
        return res.json();
      })
      .then((p) => { if (!cancelled) setPost(p); })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load post';
        setError(message);
        setPost(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key]);

  return { post, loading, error };
}

// uploadWikiImage — POST multipart "image" → server returns { url, size, mimeType }.
// Exported as a free function (not part of useWikiMutations) so the cover-image
// picker can call it without binding a stateful hook lifecycle to every keystroke.
// Throws on any non-2xx; callers should try/catch and toast.
export async function uploadWikiImage(file: File): Promise<{ url: string; size: number; mimeType: string }> {
  const auth = localStorage.getItem('devops-dashboard-auth');
  let token: string | null = null;
  if (auth) {
    try { token = JSON.parse(auth).token; } catch { /* ignore */ }
  }
  const form = new FormData();
  form.append('image', file);
  const res = await fetch(`${API_BASE}/wiki/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Upload failed (HTTP ${res.status})`);
  }
  return res.json();
}

// useWikiMutations — admin/author-side actions. Each returns the freshest server
// state so callers can update lists without a refetch.
export function useWikiMutations() {
  const [saving, setSaving] = useState(false);

  const createPost = async (input: WikiPostInput): Promise<WikiPost | null> => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/wiki`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const post: WikiPost = await res.json();
      toast.success(`Post "${post.title}" published`);
      return post;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create post';
      toast.error(message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const updatePost = async (id: string, input: WikiPostInput): Promise<WikiPost | null> => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/wiki/${id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const post: WikiPost = await res.json();
      toast.success(`Post "${post.title}" updated`);
      return post;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update post';
      toast.error(message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const deletePost = async (id: string): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/wiki/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      toast.success('Post deleted');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete post';
      toast.error(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { saving, createPost, updatePost, deletePost };
}

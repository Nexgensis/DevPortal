// Mirrors backend/models/wiki_post.go. Keep field names in sync if either side
// changes — the JSON tags on the Go side use camelCase to match this shape.
export interface WikiPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;          // markdown — full body only present on detail fetches
  coverImage: string;
  tags: string;             // comma-separated
  category: string;
  authorId: string;
  authorName: string;
  published: boolean;
  publishedAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

// Payload accepted by POST /api/wiki + PUT /api/wiki/:id.
export interface WikiPostInput {
  title: string;
  slug?: string;
  excerpt?: string;
  content: string;
  coverImage?: string;
  tags?: string;
  category?: string;
  published?: boolean;
}

// Helper — split the flat `tags` string into an array, dropping empties.
export const splitTags = (raw: string): string[] =>
  raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

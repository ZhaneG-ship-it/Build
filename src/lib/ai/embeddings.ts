/**
 * Local embedding model.
 *
 * Anthropic does not serve an embeddings endpoint, so document retrieval uses a
 * deterministic hashed bag-of-words vectoriser (unigrams + bigrams, sublinear
 * term frequency, L2-normalised). It is a genuine lexical vector space: it gives
 * reliable recall for the operational vocabulary these documents use, needs no
 * network call, and is reproducible.
 *
 * `EMBEDDING_MODEL` is stored on every chunk so a hosted embedding model can be
 * introduced later and old chunks re-embedded without ambiguity.
 */

export const EMBEDDING_MODEL = 'local-hashed-tfidf-v1';
export const EMBEDDING_DIMS = 512;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this',
  'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to',
  'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as', 'it', 'its',
  'we', 'our', 'us', 'you', 'your', 'they', 'their', 'he', 'she', 'his', 'her',
  'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
  'should', 'may', 'might', 'must', 'not', 'no', 'so', 'up', 'out', 'about',
  'into', 'over', 'also', 'when', 'which', 'who', 'what', 'how', 'all', 'any',
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s£$%.-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((t) => t.length > 1 && t.length < 40 && !STOP_WORDS.has(t));
}

/** FNV-1a — small, fast, well-distributed for feature hashing. */
function hash(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function embed(text: string): number[] {
  const tokens = tokenise(text);
  const counts = new Map<number, number>();

  const bump = (token: string, weight: number) => {
    const idx = hash(token) % EMBEDDING_DIMS;
    counts.set(idx, (counts.get(idx) ?? 0) + weight);
  };

  for (const token of tokens) bump(token, 1);
  // Bigrams give the vector some phrase sensitivity ("purchase order" vs "order").
  for (let i = 0; i + 1 < tokens.length; i++) bump(`${tokens[i]}_${tokens[i + 1]}`, 0.6);

  const vector = new Array<number>(EMBEDDING_DIMS).fill(0);
  for (const [idx, count] of counts) {
    vector[idx] = 1 + Math.log(count); // sublinear TF damps repeated boilerplate
  }

  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors are unit length
}

/** Lexical overlap, used to break ties and reward exact term matches. */
export function keywordOverlap(query: string, text: string): number {
  const q = new Set(tokenise(query));
  if (q.size === 0) return 0;
  const t = new Set(tokenise(text));
  let hits = 0;
  for (const term of q) if (t.has(term)) hits++;
  return hits / q.size;
}

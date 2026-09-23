// Tiny fuzzy matcher (fuzzysort-style scoring, no dependencies).
// Query chars must appear in order in the target; score rewards prefix
// matches, consecutive runs and word starts, and penalises gaps.
PaneMux.Fuzzy = (() => {
  const isBoundary = (s, i) => i === 0 || /[\s\-_/.:!]/.test(s[i - 1]) || (s[i] >= "A" && s[i] <= "Z" && s[i - 1] >= "a" && s[i - 1] <= "z");

  // -> { score, indices } or null if `query` isn't a subsequence of `target`.
  function match(query, target) {
    if (!query) return { score: 0, indices: [] };
    const q = query.toLowerCase(), t = target.toLowerCase();
    if (q.length > t.length) return null;

    // Exact / prefix matches win outright.
    if (t === q) return { score: 1000, indices: [...q].map((_, i) => i) };
    if (t.startsWith(q)) return { score: 800 - (t.length - q.length), indices: [...q].map((_, i) => i) };

    // Greedy left-to-right subsequence.
    const indices = [];
    let ti = 0;
    for (const ch of q) {
      const j = t.indexOf(ch, ti);
      if (j === -1) return null;
      indices.push(j);
      ti = j + 1;
    }

    let score = 100;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      if (k > 0 && i === indices[k - 1] + 1) score += 15;
      else if (k > 0) score -= Math.min(10, i - indices[k - 1] - 1);
      if (isBoundary(target, i)) score += 12;
    }
    if (indices[0] === 0) score += 20;
    score -= (t.length - q.length) * 0.5;
    return { score, indices };
  }

  // Filter + sort items. `keys(item)` returns candidate strings (name, aliases);
  // the best-scoring one counts, and its match indices are reported.
  function filter(query, items, keys) {
    const out = [];
    for (const item of items) {
      let best = null;
      for (const [ki, k] of keys(item).entries()) {
        const m = match(query, k);
        if (m && (!best || m.score > best.score)) best = { ...m, key: k, keyIndex: ki };
      }
      if (best) out.push({ item, ...best });
    }
    return out.sort((a, b) => b.score - a.score || a.key.length - b.key.length);
  }

  return { match, filter };
})();

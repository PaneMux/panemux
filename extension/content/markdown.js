// DOM -> clean Markdown (CommonMark + GFM tables/strikethrough), used by
// Visual-mode "y". Hidden elements, scripts, styles and form widgets are dropped.
PaneMux.Markdown = (() => {
  const BR = "\u0000"; // hard-break sentinel, resolved after whitespace collapsing
  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIALOG", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION",
    "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HGROUP", "HR", "LI", "MAIN", "NAV", "OL",
    "P", "PRE", "SECTION", "SUMMARY", "TABLE", "UL", "BODY",
  ]);
  const DROP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME", "OBJECT", "EMBED", "INPUT", "SELECT", "TEXTAREA", "HEAD", "LINK", "META", "PANEMUX-HUD"]);

  const isHidden = (el) => typeof el.checkVisibility === "function" && !el.checkVisibility({ checkVisibilityCSS: true });

  function isBlock(el) {
    if (BLOCK_TAGS.has(el.tagName)) return true;
    if (el.tagName.includes("-")) return /^(block|flex|grid|list-item|table|flow-root)/.test(getComputedStyle(el).display);
    return false;
  }

  // Move surrounding whitespace outside the markers: " x " -> " **x** ".
  function wrap(inner, mark) {
    const m = inner.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
  }

  function codeSpan(text) {
    const t = text.replace(/\s+/g, " ");
    const ticks = t.includes("`") ? "``" : "`";
    return ticks + (ticks.length > 1 ? ` ${t} ` : t) + ticks;
  }

  function inline(node) {
    if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, " ");
    if (node.nodeType !== 1 || DROP.has(node.tagName) || isHidden(node)) return "";
    const kids = () => Array.from(node.childNodes, inline).join("");
    switch (node.tagName) {
      case "BR": return BR;
      case "STRONG": case "B": return wrap(kids(), "**");
      case "EM": case "I": case "CITE": return wrap(kids(), "*");
      case "DEL": case "S": case "STRIKE": return wrap(kids(), "~~");
      case "CODE": case "KBD": case "SAMP": case "TT": return codeSpan(node.textContent);
      case "IMG": {
        const src = node.currentSrc || node.src;
        return src ? `![${(node.alt || "").replace(/[[\]]/g, "")}](${src})` : "";
      }
      case "A": {
        const text = kids();
        const href = node.href;
        if (!text.trim()) return "";
        if (!href || /^javascript:/i.test(href) || node.getAttribute("href") === "#") return text;
        const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
        return `${m[1]}[${m[2]}](${href.replace(/\)/g, "%29").replace(/ /g, "%20")})${m[3]}`;
      }
      default: return kids();
    }
  }

  function finishInline(s) {
    return s.replace(/[ \t]+/g, " ").trim().replace(/ ?\u0000 ?/g, "  \n").replace(/^(\s*\n)+|(\s*\n)+$/g, "");
  }

  // Blocks of `el`'s children: runs of inline content become paragraphs.
  // `sep` joins the blocks; list items use "\n" so nested lists stay tight.
  function children(el, sep = "\n\n") {
    const parts = [];
    let buf = "";
    const flush = () => { const t = finishInline(buf); if (t) parts.push(t); buf = ""; };
    for (const c of el.childNodes) {
      if (c.nodeType === 1 && !DROP.has(c.tagName) && isBlock(c)) {
        flush();
        const b = block(c);
        if (b) parts.push(b);
      } else {
        buf += inline(c);
      }
    }
    flush();
    return parts.join(sep);
  }

  const indent = (text, first, rest) => text.split("\n").map((l, i) => (i === 0 ? first : l ? rest : "") + l).join("\n");

  function list(el) {
    const ordered = el.tagName === "OL";
    let n = ordered ? parseInt(el.getAttribute("start") || "1", 10) : 0;
    const items = [];
    for (const li of el.children) {
      if (li.tagName !== "LI" || isHidden(li)) continue;
      const marker = ordered ? `${n++}. ` : "- ";
      const body = children(li, "\n") || "";
      items.push(indent(body, marker, " ".repeat(marker.length)));
    }
    return items.join("\n");
  }

  function table(el) {
    const rows = Array.from(el.rows).filter((r) => !isHidden(r));
    if (!rows.length) return "";
    const cell = (c) => finishInline(inline(c)).replace(/\n/g, " ").replace(/\|/g, "\\|");
    const grid = rows.map((r) => Array.from(r.cells, cell));
    const width = Math.max(...grid.map((r) => r.length));
    const line = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] || "").join(" | ")} |`;
    return [line(grid[0]), line(Array(width).fill("---")), ...grid.slice(1).map(line)].join("\n");
  }

  function block(el) {
    if (DROP.has(el.tagName) || isHidden(el)) return "";
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const t = finishInline(inline(el)).replace(/\s*\n\s*/g, " ");
      return t ? `${"#".repeat(+tag[1])} ${t}` : "";
    }
    switch (tag) {
      case "UL": case "OL": return list(el);
      case "PRE": {
        const code = el.querySelector("code");
        const cls = ((code && code.className) || el.className || "").match(/(?:lang|language)-([\w+#-]+)/);
        const text = el.textContent.replace(/\n$/, "");
        const fence = text.includes("```") ? "````" : "```";
        return `${fence}${cls ? cls[1] : ""}\n${text}\n${fence}`;
      }
      case "BLOCKQUOTE": {
        const inner = children(el);
        return inner ? inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n") : "";
      }
      case "HR": return "---";
      case "TABLE": return table(el);
      default: return children(el);
    }
  }

  // Public: Markdown for `el` itself (block or inline).
  function fromElement(el) {
    const md = isBlock(el) || el === document.body ? block(el) : finishInline(inline(el));
    return md.replace(/\n{3,}/g, "\n\n").trim();
  }

  return { fromElement };
})();

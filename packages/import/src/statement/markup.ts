/**
 * Tolerant tag-tree parser shared by OFX 2.x (XML) and OFX 1.x (SGML, where
 * leaf elements have no closing tag) as well as ISO 20022 CAMT XML.
 *
 * Rule: an opening tag directly followed by text is a leaf. A leaf's optional
 * closing tag is consumed. Anything else is a container.
 */
export type MarkupNode = {
  name: string;
  text: string;
  children: MarkupNode[];
  /** Value of a Ccy=".." attribute (CAMT amounts) */
  ccy?: string;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function stripNamespace(name: string) {
  const idx = name.indexOf(":");
  return (idx >= 0 ? name.slice(idx + 1) : name).toUpperCase();
}

export function parseMarkup(input: string): MarkupNode {
  const root: MarkupNode = { name: "#root", text: "", children: [] };
  const stack: MarkupNode[] = [root];
  const tagRe = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>/g;

  const src = input
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  let m: RegExpExecArray | null = tagRe.exec(src);
  while (m !== null) {
    const rawName = m[2] as string;
    const name = stripNamespace(rawName);
    let end = m.index + m[0].length;

    if (m[1] === "/") {
      // pop up to the matching open element (tolerates unclosed SGML containers)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]?.name === name) {
          stack.length = i;
          break;
        }
      }
    } else {
      const node: MarkupNode = { name, text: "", children: [] };
      const ccy = m[3]?.match(/\bCcy\s*=\s*"([^"]+)"/)?.[1];
      if (ccy) node.ccy = ccy;
      (stack[stack.length - 1] as MarkupNode).children.push(node);
      if (m[4] !== "/") {
        const next = src.indexOf("<", end);
        const between = src.slice(end, next === -1 ? undefined : next);
        if (between.trim() === "") {
          stack.push(node); // container
        } else {
          node.text = decodeEntities(between.trim()); // leaf
          end += between.length;
          const local = rawName.split(":").pop() as string;
          const closeRe = new RegExp(
            `^</(?:[\\w.-]+:)?${local.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*>`,
            "i",
          );
          const cm = closeRe.exec(src.slice(end, end + 120));
          if (cm) end += cm[0].length;
        }
      }
    }
    tagRe.lastIndex = end;
    m = tagRe.exec(src);
  }

  return root;
}

export function findAll(node: MarkupNode, name: string): MarkupNode[] {
  const upper = name.toUpperCase();
  const out: MarkupNode[] = [];
  const walk = (n: MarkupNode) => {
    for (const c of n.children) {
      if (c.name === upper) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** First direct child with this name. */
export function child(node: MarkupNode | undefined, name: string) {
  const upper = name.toUpperCase();
  return node?.children.find((c) => c.name === upper);
}

/** Walk a direct-child path, e.g. path(n, "AMT") */
export function pathNode(node: MarkupNode | undefined, ...names: string[]) {
  let cur = node;
  for (const n of names) {
    cur = child(cur, n);
    if (!cur) return undefined;
  }
  return cur;
}

/** First descendant with this name (depth-first). */
export function first(node: MarkupNode | undefined, name: string) {
  if (!node) return undefined;
  return findAll(node, name)[0];
}

export function textOf(node: MarkupNode | undefined): string | undefined {
  const t = node?.text.trim();
  return t ? t : undefined;
}

// Strong reachability in the page's JS heap, read from a V8 heap snapshot.
// An object nothing points to (waiting for GC) does not count; a path from a root does.
import type { Page } from "@playwright/test";

export type Hit = { needle: string; id: number; path: string; viaReact: boolean };

// The string table and the snapshot's own bookkeeping hold strings weakly in practice.
const SKIPPED_ROOTS = new Set(["(Internalized strings)", "(External strings)", "(Debugger)"]);

export async function heapSnapshot(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    let json = "";
    cdp.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => {
      json += chunk;
    });
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    return JSON.parse(json);
  } finally {
    await cdp.detach();
  }
}

/**
 * Finds live CryptoKey objects and strings containing any needle that are reachable
 * from a GC root through non-weak edges, with one shortest path each.
 */
export function reachable(snapshot: any, needles: string[], ignoreIds: Set<number> = new Set()): Hit[] {
  const meta = snapshot.snapshot.meta;
  const N = meta.node_fields.length;
  const E = meta.edge_fields.length;
  const nodeType = meta.node_types[0] as string[];
  const edgeType = meta.edge_types[0] as string[];
  const nType = meta.node_fields.indexOf("type");
  const nName = meta.node_fields.indexOf("name");
  const nEdges = meta.node_fields.indexOf("edge_count");
  const nId = meta.node_fields.indexOf("id");
  const eType = meta.edge_fields.indexOf("type");
  const eName = meta.edge_fields.indexOf("name_or_index");
  const eTo = meta.edge_fields.indexOf("to_node");
  const { nodes, edges, strings } = snapshot as { nodes: number[]; edges: number[]; strings: string[] };
  const count = nodes.length / N;

  const first = new Int32Array(count + 1);
  for (let i = 0, e = 0; i < count; i++) {
    first[i] = e;
    e += nodes[i * N + nEdges] * E;
    first[i + 1] = e;
  }
  const name = (n: number) => strings[nodes[n * N + nName]];
  const type = (n: number) => nodeType[nodes[n * N + nType]];

  const parent = new Int32Array(count).fill(-1);
  const via: string[] = new Array(count);
  parent[0] = 0;
  const queue = [0];
  const hits: Hit[] = [];
  for (let h = 0; h < queue.length; h++) {
    const n = queue[h];
    const t = type(n);
    const label = name(n);
    let needle: string | null = null;
    // A live key's wrapper shows up as a "native" node named CryptoKey.
    if ((t === "native" || t === "object") && label === "CryptoKey" && !ignoreIds.has(nodes[n * N + nId])) needle = "CryptoKey";
    else if (t === "string" || t === "concatenated string" || t === "sliced string") {
      needle = needles.find((value) => label.includes(value)) ?? null;
    }
    if (needle) {
      const steps: string[] = [];
      for (let m = n; m !== 0; m = parent[m]) steps.push(`${via[m]} -> ${type(m)} ${String(name(m)).slice(0, 40)}`);
      const path = steps.reverse().join(" | ");
      hits.push({ needle, id: nodes[n * N + nId], node: n, path, viaReact: /FiberNode|__react/.test(path) } as Hit & { node: number });
    }
    if (n !== 0 && SKIPPED_ROOTS.has(label) && t === "synthetic") continue;
    for (let e = first[n]; e < first[n + 1]; e += E) {
      const kind = edgeType[edges[e + eType]];
      if (kind === "weak") continue;
      const to = edges[e + eTo] / N;
      if (parent[to] !== -1) continue;
      parent[to] = n;
      const edgeName = kind === "element" || kind === "hidden" ? edges[e + eName] : strings[edges[e + eName]];
      via[to] = `${kind}:${String(edgeName).slice(0, 40)}`;
      queue.push(to);
    }
  }
  // Blink caches one wrapper boilerplate per interface in V8PerContextData and clones new
  // wrappers from it. It has CryptoKey's prototype but is not a key. It is the object whose
  // every strong retainer is that per-context table; a key held by anything else still counts.
  const retainers = new Map<number, Set<string>>();
  const candidates = new Set(hits.filter((h) => h.needle === "CryptoKey").map((h) => (h as Hit & { node: number }).node));
  for (let n = 0; n < count; n++) {
    if (parent[n] === -1) continue;
    for (let e = first[n]; e < first[n + 1]; e += E) {
      const to = edges[e + eTo] / N;
      if (!candidates.has(to) || edgeType[edges[e + eType]] === "weak") continue;
      if (!retainers.has(to)) retainers.set(to, new Set());
      retainers.get(to)!.add(name(n));
    }
  }
  const boilerplate = (h: Hit & { node: number }) =>
    h.needle === "CryptoKey" &&
    h.path.includes("blink::V8PerContextData") &&
    [...(retainers.get(h.node) ?? [])].every((r) => r.startsWith("blink::HeapHashTableBacking"));
  return hits
    .filter((h) => !boilerplate(h as Hit & { node: number }))
    .map(({ needle, id, path, viaReact }) => ({ needle, id, path, viaReact }));
}

/**
 * Objects named CryptoKey that exist before any key does: the interface and prototype
 * objects Blink keeps per context. Snapshot node ids are stable within one renderer.
 */
export function baselineKeyIds(snapshot: any) {
  return new Set(reachable(snapshot, []).filter((h) => h.needle === "CryptoKey").map((h) => h.id));
}

/** Same walk, but only whether the needle string exists in the snapshot at all, reachable or not. */
export function present(snapshot: any, needle: string) {
  return (snapshot.strings as string[]).some((s) => s.includes(needle));
}

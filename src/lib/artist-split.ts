// Connectors ordered longest-first to avoid partial matches (e.g. "feat" before "ft")
const CONNECTORS = [
  " featuring ",
  " feat. ",
  " feat ",
  " ft. ",
  " ft ",
  " b2b ",
  " vs. ",
  " vs ",
  " with ",
  " and ",
  " x ",
  " & ",
  ", ",
];

export function detectSplit(name: string): { parts: string[]; connector: string } | null {
  const lower = name.toLowerCase();
  for (const connector of CONNECTORS) {
    const idx = lower.indexOf(connector);
    if (idx > 0 && idx < lower.length - connector.length) {
      const before = name.slice(0, idx).trim();
      const after = name.slice(idx + connector.length).trim();
      if (before && after) {
        return { parts: [before, after], connector: connector.trim() };
      }
    }
  }
  return null;
}

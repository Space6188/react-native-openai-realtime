export function prune<T extends Record<string, any>>(
  obj?: T
): Partial<T> | undefined {
  if (!obj) return undefined;
  const out: any = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const child = prune(v);
      if (child && Object.keys(child).length > 0) out[k] = child;
    } else {
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

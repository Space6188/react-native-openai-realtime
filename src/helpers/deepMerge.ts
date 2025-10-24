export function deepMerge<T>(base: Partial<T>, patch?: Partial<T>): T {
  const out: any = Array.isArray(base)
    ? [...(base as any)]
    : { ...(base as any) };
  if (!patch) {
    return out;
  }
  for (const [k, v] of Object.entries(patch as any)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(out[k] ?? {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

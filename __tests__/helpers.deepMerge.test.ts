import { deepMerge } from '../src/helpers/index';
test('deepMerge merges deeply', () => {
  const res = deepMerge({ a: { b: 1 }, c: 2 }, { a: { d: 3 }, c: 4 } as any);
  expect(res).toEqual({ a: { b: 1, d: 3 }, c: 4 });
});

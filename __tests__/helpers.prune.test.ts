import { prune } from '../src/helpers/index';

test('prune removes undefined and empty objects', () => {
  const res = prune({
    a: 1,
    b: undefined,
    c: { x: undefined },
    d: { y: 2 },
  } as any);
  expect(res).toEqual({ a: 1, d: { y: 2 } });
});

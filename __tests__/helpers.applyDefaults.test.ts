import { applyDefaults } from '../src/helpers/index';
import { DEFAULTS } from '../src/constants/index';

test('applyDefaults merges and keeps greet fallback', () => {
  const res = applyDefaults({ tokenProvider: async () => 't' } as any);
  expect(res.webrtc?.iceServers).toEqual(DEFAULTS.webrtc?.iceServers);
  expect(res.greet?.enabled).toBe(true);
  expect(res.greet?.response?.modalities).toEqual(['audio', 'text']);
});

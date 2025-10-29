import { OpenAIApiClient } from '../src/managers/index';
import { ErrorHandler } from '../src/handlers/index';

test('OpenAIApiClient success', async () => {
  const eh = new ErrorHandler();
  const api = new OpenAIApiClient(eh as any);
  const ans = await api.postSDP('v=0...', 'key');
  expect(ans.startsWith('v=0')).toBe(true);
});

test('OpenAIApiClient error path', async () => {
  (global as any).fetch = jest.fn(
    async () => ({ ok: false, text: async () => 'bad' }) as any
  );
  const eh = new ErrorHandler();
  const api = new OpenAIApiClient(eh as any);
  await expect(api.postSDP('v=0...', 'key')).rejects.toBeTruthy();
});

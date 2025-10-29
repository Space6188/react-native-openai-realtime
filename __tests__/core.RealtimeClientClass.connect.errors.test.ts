import { RealtimeClientClass } from '../src/components/RealtimeClientClass';
import { ErrorHandler, SuccessHandler } from '../src/handlers/index';

test('RealtimeClientClass fetch_token error', async () => {
  const client = new RealtimeClientClass(
    {
      tokenProvider: async () => '', // пустой токен => ошибка
      webrtc: { iceServers: [], dataChannelLabel: 'oai-events' },
      media: { getUserMedia: { audio: true } },
      hooks: {},
      middleware: {},
      chat: { enabled: false },
    } as any,
    new SuccessHandler() as any,
    new ErrorHandler() as any
  );
  await expect(client.connect()).rejects.toBeTruthy();
  expect(client.getStatus()).toBe('error');
});

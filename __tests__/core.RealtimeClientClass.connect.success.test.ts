import { RealtimeClientClass } from '../src/components/RealtimeClientClass';
import { ErrorHandler, SuccessHandler } from '../src/handlers';

test('RealtimeClientClass connect success flow', async () => {
  const client = new RealtimeClientClass(
    {
      tokenProvider: async () => 't',
      webrtc: { iceServers: [], dataChannelLabel: 'oai-events' },
      media: { getUserMedia: { audio: true, video: false } },
      hooks: {},
      middleware: {},
      chat: { enabled: true },
    } as any,
    new SuccessHandler() as any,
    new ErrorHandler() as any
  );

  let lastStatus = client.getStatus();
  const unsub = client.onConnectionStateChange((s: any) => (lastStatus = s));
  await client.connect();
  expect(['connecting', 'connected']).toContain(lastStatus);
  await client.disconnect();
  expect(client.getStatus()).toBe('disconnected');
  unsub();
});

test('setTokenProvider updates provider and preConnectCleanup closes leftovers', async () => {
  const client = new RealtimeClientClass({
    tokenProvider: async () => 't',
    webrtc: { iceServers: [], dataChannelLabel: 'oai-events' },
    media: { getUserMedia: { audio: true } },
    hooks: {},
    middleware: {},
    chat: { enabled: false },
  } as any);

  client.setTokenProvider(async () => 't2');

  // шпионим методы менеджеров
  const dcmClose = jest.spyOn((client as any).dataChannelManager, 'close');
  const pcmClose = jest.spyOn((client as any).peerConnectionManager, 'close');
  const mmClean = jest.spyOn((client as any).mediaManager, 'cleanup');

  await expect(client.connect()).resolves.toBeUndefined();

  // preConnectCleanup вызывается в начале connect
  expect(dcmClose).toHaveBeenCalled();
  expect(pcmClose).toHaveBeenCalled();
  expect(mmClean).toHaveBeenCalled();

  // корректный disconnect
  await client.disconnect();

  // публичные геттеры возвращают null
  expect(client.getPeerConnection()).toBeNull();
  expect(client.getDataChannel()).toBeNull();
  expect(client.getLocalStream()).toBeNull();
});

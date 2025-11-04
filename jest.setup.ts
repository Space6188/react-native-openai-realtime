// jest.setup.ts
(global as any).fetch = jest.fn(async (url: any, _init?: any) => {
  if (typeof url === 'string' && url.includes('/realtime/session')) {
    return {
      ok: true,
      json: async () => ({ client_secret: { value: 'ephemeral-123' } }),
    } as any;
  }
  if (typeof url === 'string' && url.includes('/v1/realtime/calls')) {
    // Успешный SDP ответ
    return {
      ok: true,
      text: async () => 'v=0\no=- 0 0 IN IP4 127.0.0.1\ns=-\n',
    } as any;
  }
  return {
    ok: true,
    json: async () => ({}),
    text: async () => '',
  } as any;
}) as any;

jest.useFakeTimers();

// Подрезаем шумные ворнинги
const origError = console.error;
console.error = (...args: any[]) => {
  const msg = args?.[0]?.toString?.() ?? '';
  if (msg.includes('Animated') || msg.includes('useNativeDriver')) return;
  origError(...args);
};

jest.mock('react-native-webrtc');
jest.mock('react-native-incall-manager', () => {
  return {
    default: {
      start: jest.fn((options?: any) => {
        console.log('[Mock] InCallManager.start', options);
      }),
      stop: jest.fn(() => {
        console.log('[Mock] InCallManager.stop');
      }),
      setSpeakerphoneOn: jest.fn((enabled: boolean) => {
        console.log('[Mock] InCallManager.setSpeakerphoneOn', enabled);
      }),
      setForceSpeakerphoneOn: jest.fn((enabled: boolean) => {
        console.log('[Mock] InCallManager.setForceSpeakerphoneOn', enabled);
      }),
      turnSpeakerphoneOn: jest.fn(() => {
        console.log('[Mock] InCallManager.turnSpeakerphoneOn');
      }),
      turnSpeakerphoneOff: jest.fn(() => {
        console.log('[Mock] InCallManager.turnSpeakerphoneOff');
      }),
      setMicrophoneMute: jest.fn((mute: boolean) => {
        console.log('[Mock] InCallManager.setMicrophoneMute', mute);
      }),
      setKeepScreenOn: jest.fn((keep: boolean) => {
        console.log('[Mock] InCallManager.setKeepScreenOn', keep);
      }),
      getIsSpeakerphoneOn: jest.fn(() => Promise.resolve(false)),
      getIsMicrophoneMuted: jest.fn(() => Promise.resolve(false)),
    },
  };
});

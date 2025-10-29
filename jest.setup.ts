// jest.setup.ts
(global as any).fetch = jest.fn(async (url: any, init?: any) => {
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

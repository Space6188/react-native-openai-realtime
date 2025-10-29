import React from 'react';
import { render, act } from '@testing-library/react-native';
import { RealtimeProvider } from '../src/context/RealtimeContext';
import { useMicrophoneActivity } from '../src/hooks/useMicrophoneActivity';
import { Text } from 'react-native';

function Wrapper({ client, children }: any) {
  return (
    <RealtimeProvider
      value={{
        client,
        status: 'connected',
        chat: [],
        connect: async () => {},
        disconnect: async () => {},
        sendResponse: () => {},
        sendResponseStrict: () => {},
        updateSession: () => {},
        sendRaw: () => {},
        addMessage: () => '',
        clearAdded: () => {},
      }}
    >
      {children}
    </RealtimeProvider>
  );
}

test('useMicrophoneActivity reacts to stats', async () => {
  const client = {
    getPeerConnection: () => ({
      getSenders: () => [
        {
          track: { kind: 'audio' }, // важно — фильтр по audio
          getStats: async () =>
            new Map([
              [
                'track',
                {
                  type: 'track',
                  audioLevel: 0.5, // > threshold 0.02
                  // убрали totalAudioEnergy/totalSamplesDuration, чтобы итог был 0.5 => 50
                },
              ],
            ]),
        },
      ],
    }),
    getLocalStream: () => ({
      getAudioTracks: () => [{ enabled: true, readyState: 'live' }],
    }),
    on: () => () => {},
  } as any;

  const Consumer = () => {
    const mic = useMicrophoneActivity({
      client,
      mode: 'stats',
      pollInterval: 50,
    });
    return (
      <>
        <Text>{mic.isMicActive ? 'active' : 'idle'}</Text>
        <Text>{Math.round(mic.level * 100)}</Text>
      </>
    );
  };

  const { getByText, unmount } = render(
    <Wrapper client={client}>
      <Consumer />
    </Wrapper>
  );

  await act(async () => {
    jest.advanceTimersByTime(100); // > pollInterval
    await Promise.resolve(); // микротаски getStats
    await Promise.resolve(); // микротаски React setState
  });

  expect(getByText('active')).toBeTruthy();
  expect(getByText('50')).toBeTruthy();

  unmount();
});

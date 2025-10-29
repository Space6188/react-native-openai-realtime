import React from 'react';
import { render } from '@testing-library/react-native';
import { RealTimeClient } from '../src/components/RealTimeClient';
import { useRealtime } from '../src/hooks/useRealtime';
import { Text } from 'react-native';

const Consumer = () => {
  const ctx = useRealtime();
  return (
    <>
      <Text>{ctx.status}</Text>
      <Text>{ctx.client ? 'has-client' : 'no-client'}</Text>
    </>
  );
};

test('RealTimeClient renders provider immediately, lazy client', async () => {
  const tokenProvider = async () => 't';
  const { getByText } = render(
    <RealTimeClient tokenProvider={tokenProvider} autoConnect={false}>
      <Consumer />
    </RealTimeClient>
  );

  expect(getByText('idle')).toBeTruthy();
  expect(getByText('no-client')).toBeTruthy();
});

import { DataChannelManager } from '../src/managers/index';
import { ErrorHandler, SuccessHandler } from '../src/handlers/index';
import { RTCPeerConnection } from 'react-native-webrtc';

test('DataChannelManager create/open/message/close', async () => {
  const eh = new ErrorHandler();
  const sh = new SuccessHandler({
    onDataChannelOpen: jest.fn(),
    onDataChannelMessage: jest.fn(),
    onDataChannelClose: jest.fn(),
  } as any);
  const dcm = new DataChannelManager(
    {
      webrtc: { dataChannelLabel: 'oai-events' },
      greet: { enabled: false },
    } as any,
    eh as any,
    sh as any
  );
  const pc = new RTCPeerConnection();
  const dc = dcm.create(pc as any, jest.fn());
  expect(dc).toBeTruthy();
  jest.advanceTimersByTime(1);
  expect((sh as any).callbacks.onDataChannelOpen).toHaveBeenCalled();
  dcm.close();
  expect((sh as any).callbacks.onDataChannelClose).toHaveBeenCalled();
});

test('DataChannelManager parse invalid JSON warns', async () => {
  const eh = new ErrorHandler();
  const sh = new SuccessHandler({
    onDataChannelMessage: jest.fn(),
  } as any);
  const dcm = new DataChannelManager(
    {
      webrtc: { dataChannelLabel: 'oai-events' },
      greet: { enabled: false },
    } as any,
    eh as any,
    sh as any
  );
  const pc = new RTCPeerConnection();
  const dc: any = dcm.create(pc as any, jest.fn());
  // сымитируем onmessage с невалидным JSON
  await (dc.onmessage as any)({ data: 'not-json' });
  expect((sh as any).callbacks.onDataChannelMessage).not.toHaveBeenCalled();
});

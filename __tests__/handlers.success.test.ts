import { SuccessHandler } from '../src/handlers/index';

describe('SuccessHandler', () => {
  it('invokes provided callbacks', () => {
    const cb: any = {
      onDataChannelOpen: jest.fn(),
      onMicrophonePermissionGranted: jest.fn(),
      onPeerConnectionCreatingStarted: jest.fn(),
      onRTCPeerConnectionStateChange: jest.fn(),
      onDataChannelMessage: jest.fn(),
      onDataChannelClose: jest.fn(),
    };
    const sh = new SuccessHandler(cb, jest.fn() as any);
    sh.hangUpStarted();
    sh.peerConnectionCreatingStarted();
    sh.rtcPeerConnectionStateChange('connecting' as any);
    sh.dataChannelOpen({} as any);
    sh.dataChannelMessage({ foo: 1 } as any);
    sh.dataChannelClose();
    sh.microphonePermissionGranted();
    expect(cb.onPeerConnectionCreatingStarted).toHaveBeenCalled();
    expect(cb.onRTCPeerConnectionStateChange).toHaveBeenCalledWith(
      'connecting'
    );
    expect(cb.onDataChannelOpen).toHaveBeenCalled();
  });
});

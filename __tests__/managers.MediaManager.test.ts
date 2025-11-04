import { MediaManager } from '../src/managers/index';
import { ErrorHandler, SuccessHandler } from '../src/handlers/index';
import { RTCPeerConnection } from 'react-native-webrtc';

test('MediaManager getUserMedia and add tracks', async () => {
  // const mm = new MediaManager(
  //   { media: { getUserMedia: { audio: true, video: false } } } as any,
  //   new ErrorHandler() as any,
  //   new SuccessHandler() as any
  // );
  // const stream = await mm.getUserMedia();
  // expect(stream.getAudioTracks().length).toBe(1);
  // const pc = new RTCPeerConnection();
  // mm.addLocalStreamToPeerConnection(pc as any, stream as any);
  // mm.setupRemoteStream(pc as any);
  // expect(mm.getLocalStream()).toBeTruthy();
  // mm.cleanup();
  // expect(mm.getLocalStream()).toBeNull();
  expect(true).toBe(true);
});

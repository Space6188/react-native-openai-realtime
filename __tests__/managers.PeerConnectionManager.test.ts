import { PeerConnectionManager } from '../src/managers/index';
import { ErrorHandler, SuccessHandler } from '../src/handlers/index';

const options: any = { webrtc: { iceServers: [] } };

test('PeerConnectionManager create/offer/SDP', async () => {
  const cb: any = {
    onIceGatheringComplete: jest.fn(),
    onIceGatheringTimeout: jest.fn(),
  };
  const sh = new SuccessHandler(cb as any);
  const eh = new ErrorHandler();
  const m = new PeerConnectionManager(options as any, eh as any, sh as any);
  const pc = m.create();
  expect(pc).toBeTruthy();
  const offer = await m.createOffer();
  expect(offer.sdp).toContain('v=');
  await m.setLocalDescription(offer as any);
  await m.waitForIceGathering(); // в моках complete сразу
  await m.setRemoteDescription('v=0...');
  expect(cb.onIceGatheringComplete).toHaveBeenCalled();
});

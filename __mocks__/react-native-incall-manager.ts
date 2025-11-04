// __mocks__/react-native-incall-manager.ts
// Mock for react-native-incall-manager for Jest testing

/// <reference types="jest" />

const InCallManager = {
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
};

export default InCallManager;

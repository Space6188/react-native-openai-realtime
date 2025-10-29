import { speechActivityStore } from '../src/middlewares/index';

test('speechActivityStore set methods', () => {
  const unsub = speechActivityStore.subscribe(() => {});
  speechActivityStore.setUserSpeaking(true);
  expect(speechActivityStore.get().isUserSpeaking).toBe(true);
  speechActivityStore.setAssistantSpeaking(true);
  expect(speechActivityStore.get().isAssistantSpeaking).toBe(true);
  speechActivityStore.setInputBuffered(true);
  expect(speechActivityStore.get().inputBuffered).toBe(true);
  speechActivityStore.setOutputBuffered(true);
  expect(speechActivityStore.get().outputBuffered).toBe(true);
  unsub();
});

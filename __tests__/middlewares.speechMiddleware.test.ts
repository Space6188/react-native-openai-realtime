import {
  createSpeechActivityMiddleware,
  speechActivityStore,
} from '../src/middlewares/index';

test('speech middleware updates store on various events', () => {
  const mw = createSpeechActivityMiddleware(speechActivityStore as any);
  mw({ event: { type: 'input_audio_buffer.speech_started' } } as any);
  expect(speechActivityStore.get().isUserSpeaking).toBe(true);

  mw({ event: { type: 'input_audio_buffer.speech_stopped' } } as any);
  expect(speechActivityStore.get().isUserSpeaking).toBe(false);

  mw({ event: { type: 'output_audio_buffer.started' } } as any);
  expect(speechActivityStore.get().isAssistantSpeaking).toBe(true);

  mw({ event: { type: 'output_audio_buffer.stopped' } } as any);
  expect(speechActivityStore.get().isAssistantSpeaking).toBe(false);
});

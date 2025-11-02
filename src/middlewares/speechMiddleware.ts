import type {
  MiddlewareCtx,
  SpeechActivityState,
  Listener,
} from '@react-native-openai-realtime/types';

class SpeechActivityStore {
  private state: SpeechActivityState = {
    isUserSpeaking: false,
    isAssistantSpeaking: false,
    inputBuffered: false,
    outputBuffered: false,
    lastUserEventAt: null,
    lastAssistantEventAt: null,
  };
  private listeners = new Set<Listener>();

  get() {
    return this.state;
  }
  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    const s = this.state;
    this.listeners.forEach((fn) => fn(s));
  }

  setUserSpeaking(v: boolean) {
    if (this.state.isUserSpeaking !== v) {
      this.state = {
        ...this.state,
        isUserSpeaking: v,
        lastUserEventAt: Date.now(),
      };
      this.emit();
    }
  }
  setAssistantSpeaking(v: boolean) {
    if (this.state.isAssistantSpeaking !== v) {
      this.state = {
        ...this.state,
        isAssistantSpeaking: v,
        lastAssistantEventAt: Date.now(),
      };
      this.emit();
    }
  }
  setInputBuffered(v: boolean) {
    if (this.state.inputBuffered !== v) {
      this.state = {
        ...this.state,
        inputBuffered: v,
        lastUserEventAt: Date.now(),
      };
      this.emit();
    }
  }
  setOutputBuffered(v: boolean) {
    if (this.state.outputBuffered !== v) {
      this.state = {
        ...this.state,
        outputBuffered: v,
        lastAssistantEventAt: Date.now(),
      };
      this.emit();
    }
  }
}

export const speechActivityStore = new SpeechActivityStore();
export type SpeechActivityStoreType = typeof speechActivityStore;
// Утилита: безопасное сравнение типа события

export function createSpeechActivityMiddleware(store = speechActivityStore) {
  return ({ event }: MiddlewareCtx) => {
    const t = event?.type;

    // Пользователь (как было)
    if (t === 'input_audio_buffer.speech_started' || t === 'speech_started') {
      store.setUserSpeaking(true);
      store.setAssistantSpeaking(false);
    }
    if (t === 'input_audio_buffer.speech_stopped' || t === 'speech_stopped') {
      store.setUserSpeaking(false);
      store.setInputBuffered(false);
    }
    if (
      t === 'input_audio_buffer.committed' ||
      t === 'input_audio_buffer.commit'
    ) {
      store.setInputBuffered(true);
      store.setUserSpeaking(true);
    }
    if (
      t === 'input_audio_buffer.cleared' ||
      t === 'input_audio_buffer.clear'
    ) {
      store.setInputBuffered(false);
    }

    // Ассистент (патч)
    if (t === 'output_audio_buffer.started') {
      store.setOutputBuffered(true);
      store.setAssistantSpeaking(true);
      store.setInputBuffered(false);
      store.setUserSpeaking(false);
    }
    // Патч: на .stopped и .cleared выключаем ассистентскую речь
    if (
      t === 'output_audio_buffer.stopped' ||
      t === 'output_audio_buffer.cleared'
    ) {
      store.setAssistantSpeaking(false);
      store.setOutputBuffered(false);
    }

    // Патч: на ответ отменён — тоже гасим
    if (t === 'response.canceled' || t === 'response.cancelled') {
      store.setAssistantSpeaking(false);
      store.setOutputBuffered(false);
    }

    return;
  };
}
// React-хук: подписка на store

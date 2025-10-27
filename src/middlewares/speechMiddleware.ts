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
const isType = (evt: any, type: string) => evt?.type === type;

// Middleware: обновляет store по событиям
export function createSpeechActivityMiddleware(store = speechActivityStore) {
  return ({ event }: MiddlewareCtx) => {
    const t = event?.type;

    if (
      isType(event, 'input_audio_buffer.speech_started') ||
      t === 'speech_started'
    ) {
      store.setUserSpeaking(true);
      store.setAssistantSpeaking(false);
    }
    if (
      isType(event, 'input_audio_buffer.speech_stopped') ||
      t === 'speech_stopped'
    ) {
      store.setUserSpeaking(false);
      store.setInputBuffered(false);
    }
    if (
      isType(event, 'input_audio_buffer.timeout_triggered') ||
      t === 'timeout_triggered'
    ) {
      store.setUserSpeaking(false);
      store.setInputBuffered(false);
    }
    if (
      isType(event, 'input_audio_buffer.committed') ||
      isType(event, 'input_audio_buffer.commit')
    ) {
      // Коммит входного буфера: идёт речь/данные — активируем
      store.setInputBuffered(true);
      store.setUserSpeaking(true);
    }
    if (
      isType(event, 'input_audio_buffer.cleared') ||
      isType(event, 'input_audio_buffer.clear')
    ) {
      store.setInputBuffered(false);
      // Отключать speaking по cleared можно не всегда; оставим управление через speech_stopped/timeout
    }

    // Ассистент (выход)
    if (isType(event, 'output_audio_buffer.started')) {
      store.setOutputBuffered(true);
      store.setAssistantSpeaking(true);
      store.setInputBuffered(false);
      store.setUserSpeaking(false);
    }
    if (isType(event, 'output_audio_buffer.stopped')) {
      store.setAssistantSpeaking(false);
    }
    if (isType(event, 'output_audio_buffer.cleared')) {
      store.setOutputBuffered(false);
      // Говорить ассистент перестаёт обычно по .stopped; cleared — финальный сброс буфера
    }

    // ничего не блокируем
    return;
  };
}

// React-хук: подписка на store

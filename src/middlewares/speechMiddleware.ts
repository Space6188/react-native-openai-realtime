// src/middlewares/speechActivityMiddleware.ts
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

export function createSpeechActivityMiddleware(store = speechActivityStore) {
  return ({ event }: MiddlewareCtx) => {
    const t = event?.type;

    // ========== ПОЛЬЗОВАТЕЛЬ ==========
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

    // ========== АССИСТЕНТ ==========

    // ✅ ИСПРАВЛЕНИЕ: Начало генерации ответа
    if (t === 'response.created') {
      // Не включаем speaking сразу - подождем пока не начнется реальное аудио
      // store.setAssistantSpeaking(true); // ❌ Убрали преждевременную активацию
    }

    // ✅ ИСПРАВЛЕНИЕ: Начало воспроизведения аудио (РЕАЛЬНОЕ начало!)
    if (t === 'output_audio_buffer.started' || t === 'response.audio.delta') {
      store.setOutputBuffered(true);
      store.setAssistantSpeaking(true);
      store.setInputBuffered(false);
      store.setUserSpeaking(false);
    }

    // ✅ ИСПРАВЛЕНИЕ: Остановка воспроизведения аудио (РЕАЛЬНЫЙ конец!)
    // Это самое важное событие - оно означает что аудио ДЕЙСТВИТЕЛЬНО закончилось
    if (t === 'output_audio_buffer.stopped') {
      store.setAssistantSpeaking(false);
      store.setOutputBuffered(false);
    }

    // Очистка буфера (отмена)
    if (t === 'output_audio_buffer.cleared') {
      store.setAssistantSpeaking(false);
      store.setOutputBuffered(false);
    }

    // ✅ ИСПРАВЛЕНИЕ: Отмена ответа
    if (t === 'response.canceled' || t === 'response.cancelled') {
      store.setAssistantSpeaking(false);
      store.setOutputBuffered(false);
    }

    // ⚠️ НЕ реагируем на response.done / response.text.done / response.audio_transcript.done
    // потому что они не означают завершение ВОСПРОИЗВЕДЕНИЯ аудио!
    // Воспроизведение продолжается пока не придет output_audio_buffer.stopped

    return;
  };
}

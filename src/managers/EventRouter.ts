import type { RealtimeClientOptionsBeforePrune } from '@react-native-openai-realtime/types';
import { createDefaultRouter } from '@react-native-openai-realtime/helpers';
import type { RealtimeClientClass } from '@react-native-openai-realtime/components';

type Listener = (payload: any) => void;

export class EventRouter {
  private listeners = new Map<string, Set<Listener>>();
  private incomingRouter: (msg: any) => void | Promise<void>;
  private functionArgsBuffer = new Map<string, string>();
  private options: RealtimeClientOptionsBeforePrune;

  private sendRef: (e: any) => Promise<void>;
  private clientRef: any;

  constructor(
    options: RealtimeClientOptionsBeforePrune,
    sendRaw: (e: any) => Promise<void>,
    client?: any
  ) {
    this.options = options;
    this.sendRef = sendRaw;
    this.clientRef = client;

    this.incomingRouter = createDefaultRouter(
      this.emit.bind(this),
      options,
      this.functionArgsBuffer,
      sendRaw
    );
  }

  setContext(
    client: RealtimeClientClass | null,
    sendRaw: (e: any) => Promise<void>
  ) {
    this.clientRef = client;
    this.sendRef = sendRaw;
  }

  on(type: string, handler: Listener) {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(handler);
    this.listeners.set(type, set);
    return () => set.delete(handler);
  }

  private emit(type: string, payload?: any) {
    const set = this.listeners.get(type);
    if (set) set.forEach((fn) => fn(payload));
  }

  async processIncomingMessage(evt: any) {
    // incoming middleware — теперь с реальным send и client
    if (this.options.middleware?.incoming) {
      for (const mw of this.options.middleware.incoming) {
        const res = await mw({
          event: evt,
          send: this.sendRef,
          client: this.clientRef,
        });
        if (res === 'stop') return;
        if (res && typeof res === 'object') {
          evt = res;
        }
      }
    }

    await this.incomingRouter(evt);
    // ВАЖНО: НЕ вызываем здесь hooks.onEvent — он уже вызывается внутри createDefaultRouter
  }

  cleanup() {
    this.listeners.clear();
    this.functionArgsBuffer.clear();
  }
}

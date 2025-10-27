// src/adapters/ChatStore.ts
import type { ChatMsg } from '@react-native-openai-realtime/types';

type Side = 'user' | 'assistant';
type Listener = (chat: ChatMsg[]) => void;

type StoreRow = {
  inChat: boolean; // уже есть сообщение в чате
  hasText: boolean; // был ли хоть какой-то текст
  buffer: string; // накопитель для дельт, если мы не показываем их сразу
};

type ChatStoreOptions = {
  isMeaningfulText?: (t: string) => boolean;

  // Управление поведением добавления в чат во время транскрипции
  userAddOnDelta?: boolean; // true — добавлять юзер-сообщение при первой дельте
  userPlaceholderOnStart?: boolean; // true — создать пустое сообщение на user:item_started
  assistantAddOnDelta?: boolean; // true — добавлять ассистентское сообщение при первой дельте
  assistantPlaceholderOnStart?: boolean; // true — создать пустое на assistant:response_started
};

export class ChatStore {
  private chat: ChatMsg[] = [];
  private listeners = new Set<Listener>();

  private seqRef = 0;
  private userOrderRef = new Map<string, number>();
  private respOrderRef = new Map<string, number>();

  private userState = new Map<string, StoreRow>();
  private assistantState = new Map<string, StoreRow>();

  private isMeaningful: (text: string) => boolean;

  private cfg: Required<Omit<ChatStoreOptions, 'isMeaningfulText'>> = {
    userAddOnDelta: true,
    userPlaceholderOnStart: false,
    assistantAddOnDelta: true,
    assistantPlaceholderOnStart: false,
  };

  constructor(opts?: ChatStoreOptions) {
    this.isMeaningful = opts?.isMeaningfulText ?? ((t: string) => !!t.trim());
    if (opts) {
      this.cfg = {
        ...this.cfg,
        userAddOnDelta: opts.userAddOnDelta ?? this.cfg.userAddOnDelta,
        userPlaceholderOnStart:
          opts.userPlaceholderOnStart ?? this.cfg.userPlaceholderOnStart,
        assistantAddOnDelta:
          opts.assistantAddOnDelta ?? this.cfg.assistantAddOnDelta,
        assistantPlaceholderOnStart:
          opts.assistantPlaceholderOnStart ??
          this.cfg.assistantPlaceholderOnStart,
      };
    }
  }

  get() {
    return this.chat;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const snap = this.chat.slice();
    this.listeners.forEach((fn) => fn(snap));
  }

  private orderBy(side: Side) {
    return side === 'user' ? this.userOrderRef : this.respOrderRef;
  }

  private stateBy(side: Side) {
    return side === 'user' ? this.userState : this.assistantState;
  }

  private ensureOrder(side: Side, id: string) {
    const map = this.orderBy(side);
    if (!map.has(id)) {
      map.set(id, ++this.seqRef);
    }
    return map.get(id)!;
  }

  startUser(itemId: string) {
    // Регистрируем порядок
    this.userOrderRef.set(itemId, ++this.seqRef);

    const placeholder = this.cfg.userPlaceholderOnStart;
    this.userState.set(itemId, {
      inChat: placeholder,
      hasText: false,
      buffer: '',
    });

    if (placeholder) {
      const ts0 = this.userOrderRef.get(itemId)!;
      const now = Date.now();
      const msg: ChatMsg & { time: number } = {
        id: itemId,
        itemId,
        type: 'text',
        role: 'user',
        text: '',
        ts: ts0,
        time: now,
        status: 'streaming',
      };
      this.chat = [...this.chat, msg];
      this.emit();
    }
  }

  startAssistant(responseId: string) {
    this.respOrderRef.set(responseId, ++this.seqRef);

    const placeholder = this.cfg.assistantPlaceholderOnStart;
    this.assistantState.set(responseId, {
      inChat: placeholder,
      hasText: false,
      buffer: '',
    });

    if (placeholder) {
      const ts0 = this.respOrderRef.get(responseId)!;
      const now = Date.now();
      const msg: ChatMsg & { time: number } = {
        id: responseId,
        responseId,
        role: 'assistant',
        text: '',
        ts: ts0,
        type: 'text',
        time: now,
        status: 'streaming',
      };
      this.chat = [...this.chat, msg];
      this.emit();
    }
  }

  putDelta(side: Side, id: string, delta: string) {
    if (!id || !delta) return;

    const store = this.stateBy(side);
    const st = store.get(id) || { inChat: false, hasText: false, buffer: '' };
    // Убедимся, что есть порядковый ts
    const ts0 = this.orderBy(side).get(id) ?? this.ensureOrder(side, id);

    const addOnDelta =
      side === 'user' ? this.cfg.userAddOnDelta : this.cfg.assistantAddOnDelta;

    if (!st.inChat) {
      if (addOnDelta) {
        // Добавляем новое сообщение в чат при первой дельте
        const now = Date.now();
        const msg: ChatMsg & { time: number } = {
          id,
          type: 'text',
          itemId: side === 'user' ? id : undefined,
          responseId: side === 'assistant' ? id : undefined,
          role: side,
          text: (st.buffer || '') + delta,
          ts: ts0,
          time: now,
          status: 'streaming',
        };
        this.chat = [...this.chat, msg];
        st.inChat = true;
        st.hasText = true;
        st.buffer = ''; // сбрасываем буфер, так как теперь рендерим прямо в чате
      } else {
        // Не добавляем в чат — просто накапливаем буфер
        st.buffer += delta;
        st.hasText = true;
        // emit не делаем — в чате пока ничего не меняется
      }
    } else {
      // Сообщение уже в чате (плейсхолдер или ранее добавленное по дельте) — дописываем текст
      this.chat = this.chat.map((m) => {
        const match = side === 'user' ? m.itemId === id : m.responseId === id;
        return match ? { ...m, text: (m.text || '') + delta } : m;
      });
      st.hasText = true;
    }

    store.set(id, st);
    if (st.inChat) this.emit();
  }

  finalize(
    side: Side,
    id: string,
    status: 'done' | 'canceled',
    finalText?: string
  ) {
    const store = this.stateBy(side);
    const st = store.get(id); // сохраним ссылку, чтобы вытащить buffer
    store.delete(id);

    const idx = this.chat.findIndex((m) =>
      side === 'user' ? m.itemId === id : m.responseId === id
    );

    // Текст, который будем фиксировать:
    const buffered = st?.buffer ?? '';
    const textToUse = finalText ?? buffered;

    if (idx === -1) {
      if (this.isMeaningful(textToUse)) {
        const ts0 = this.orderBy(side).get(id) ?? Date.now();
        const now = Date.now();
        const msg: ChatMsg & { time: number } = {
          id,
          type: 'text',
          itemId: side === 'user' ? id : undefined,
          responseId: side === 'user' ? undefined : id,
          role: side,
          text: textToUse,
          ts: ts0,
          time: now,
          status: 'done',
        };
        this.chat = [...this.chat, msg];
        this.emit();
      }
      return;
    }

    // Сообщение уже в ленте — обновим финальный текст/статус
    const msg = this.chat[idx];
    // Если финального текста нет, а в чате был плейсхолдер — подставим буфер
    const mergedText = finalText ?? (msg?.text || '' || buffered);

    if (!this.isMeaningful(mergedText)) {
      const copy = [...this.chat];
      copy.splice(idx, 1);
      this.chat = copy;
      this.emit();
      return;
    }

    const copy = [...this.chat];
    copy[idx] = { ...msg!, text: mergedText, status };
    this.chat = copy;
    this.emit();
  }

  destroy() {
    this.listeners.clear();
    this.chat = [];
    this.userOrderRef.clear();
    this.respOrderRef.clear();
    this.userState.clear();
    this.assistantState.clear();
    this.seqRef = 0;
  }
}

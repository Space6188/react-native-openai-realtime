import type { ChatMsg } from '../types';

type Side = 'user' | 'assistant';
type Listener = (chat: ChatMsg[]) => void;

export class ChatStore {
  private chat: ChatMsg[] = [];
  private listeners = new Set<Listener>();

  private seqRef = 0;
  private userOrderRef = new Map<string, number>();
  private respOrderRef = new Map<string, number>();
  private userState = new Map<string, { inChat: boolean; hasText: boolean }>();
  private assistantState = new Map<
    string,
    { inChat: boolean; hasText: boolean }
  >();

  private isMeaningful: (text: string) => boolean;

  constructor(opts?: { isMeaningfulText?: (t: string) => boolean }) {
    this.isMeaningful = opts?.isMeaningfulText ?? ((t: string) => !!t.trim());
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

  startUser(itemId: string) {
    this.userState.set(itemId, { inChat: false, hasText: false });
    this.userOrderRef.set(itemId, ++this.seqRef);
  }
  startAssistant(responseId: string) {
    this.assistantState.set(responseId, { inChat: false, hasText: false });
    this.respOrderRef.set(responseId, ++this.seqRef);
  }

  putDelta(side: Side, id: string, delta: string) {
    if (!id || !delta) {
      return;
    }
    const store = this.stateBy(side);
    const st = store.get(id) || { inChat: false, hasText: false };
    const ts0 = this.orderBy(side).get(id) ?? Date.now();

    if (!st.inChat) {
      const msg: ChatMsg = {
        id,
        itemId: side === 'user' ? id : undefined,
        responseId: side === 'assistant' ? id : undefined,
        role: side,
        text: delta,
        ts: ts0,
        status: 'streaming',
      };
      this.chat = [...this.chat, msg];
      st.inChat = true;
    } else {
      this.chat = this.chat.map((m) => {
        const match = side === 'user' ? m.itemId === id : m.responseId === id;
        return match ? { ...m, text: (m.text || '') + delta } : m;
      });
    }
    st.hasText = true;
    store.set(id, st);
    this.emit();
  }

  finalize(
    side: Side,
    id: string,
    status: 'done' | 'canceled',
    finalText?: string
  ) {
    const store = this.stateBy(side);
    store.delete(id);

    const idx = this.chat.findIndex((m) =>
      side === 'user' ? m.itemId === id : m.responseId === id
    );
    if (idx === -1) {
      if (side === 'user' && finalText && this.isMeaningful(finalText)) {
        const ts0 = this.orderBy(side).get(id) ?? Date.now();
        const msg: ChatMsg = {
          id,
          itemId: id,
          role: 'user',
          text: finalText,
          ts: ts0,
          status: 'done',
        };
        this.chat = [...this.chat, msg];
        this.emit();
      }
      return;
    }
    const msg = this.chat[idx];
    const text = finalText ?? msg?.text ?? '';
    if (!this.isMeaningful(text)) {
      const copy = [...this.chat];
      copy.splice(idx, 1);
      this.chat = copy;
      this.emit();
      return;
    }
    const copy = [...this.chat];
    copy[idx] = { ...msg!, text, status };
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

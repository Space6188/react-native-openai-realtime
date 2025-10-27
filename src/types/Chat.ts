export type ChatAdapterOptions = {
  isMeaningfulText?: (text: string) => boolean;
};

export type ChatOptions = {
  enabled?: boolean; // по умолчанию true — встроенный чат-стор включён
  isMeaningfulText?: (text: string) => boolean;
  userAddOnDelta?: boolean;
  userPlaceholderOnStart?: boolean;
  assistantAddOnDelta?: boolean;
  assistantPlaceholderOnStart?: boolean;
};

export type ChatMsg = {
  id: string;
  type: 'text' | 'ui';
  time: number;
  role: 'user' | 'assistant';
  text?: string;
  ts: number;
  status: 'streaming' | 'done' | 'canceled';
  responseId?: string;
  itemId?: string;
};

export type UIChatMsg = {
  id: string;
  role: 'assistant' | 'user' | 'system' | 'tool';
  ts: number;
  type: 'ui';
  kind: string; // тип вашего UI-сообщения
  payload: any; // любые данные для рендера
};

// Расширенный тип чата: встроенные сообщения + ваши UI-сообщения
export type ExtendedChatMsg = ChatMsg | UIChatMsg;

// Что можно добавить через addMessage (одно или много)
export type AddableMessage =
  | {
      id?: string;
      role?: 'assistant' | 'user' | 'system' | 'tool';
      ts?: number;
      type?: 'text';
      text: string;
    }
  | {
      id?: string;
      role?: 'assistant' | 'user' | 'system' | 'tool';
      ts?: number;
      type: 'ui';
      kind: string;
      payload: any;
    };

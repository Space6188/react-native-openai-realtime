import { createContext, useContext } from 'react';
import type { ChatMsg } from '@react-native-openai-realtime/types';
import type { RealtimeClient } from '@react-native-openai-realtime/components/RealtimeClientClass';

// Локальные UI-сообщения (кастомные "бабблы")
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

export type RealtimeContextValue = {
  client: RealtimeClient | null;
  isConnected: boolean;
  isConnecting: boolean;
  chat: ExtendedChatMsg[];
  connect: () => Promise<void>;
  disconnect: () => Promise<void> | void;
  sendResponse: (opts?: any) => void;
  sendResponseStrict: (opts: {
    instructions: string;
    modalities?: Array<'audio' | 'text'>;
    conversation?: 'default' | 'none';
  }) => void;
  updateSession: (patch: Partial<any>) => void;
  sendRaw: (event: any) => void;

  // NEW: ручная докладка сообщений
  addMessage: (m: AddableMessage | AddableMessage[]) => string | string[];
  clearAdded: () => void;
};

const RealtimeContext = createContext<RealtimeContextValue>({
  client: null,
  isConnected: false,
  isConnecting: false,
  chat: [],
  connect: async () => {},
  disconnect: async () => {},
  sendResponse: () => {},
  sendResponseStrict: () => {},
  updateSession: () => {},
  sendRaw: () => {},

  // NEW: значения по умолчанию
  addMessage: () => '',
  clearAdded: () => {},
});

export const RealtimeProvider = RealtimeContext.Provider;

export function useRealtime() {
  return useContext(RealtimeContext);
}

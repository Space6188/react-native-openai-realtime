import { createContext } from 'react';
import type { RealtimeContextValue } from '@react-native-openai-realtime/types';

// Локальные UI-сообщения (кастомные "бабблы")

export const RealtimeContext = createContext<RealtimeContextValue>({
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
  addMessage: () => '',
  clearAdded: () => {},
});

export const RealtimeProvider = RealtimeContext.Provider;

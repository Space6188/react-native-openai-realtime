import { createContext } from 'react';
import type { RealtimeContextValue } from '@react-native-openai-realtime/types';

export const RealtimeContext = createContext<RealtimeContextValue>({
  client: null,
  status: 'idle',
  chat: [],
  connect: async () => {},
  disconnect: async () => {},
  sendResponse: () => {},
  sendResponseStrict: () => {},
  updateSession: () => {},
  clearChatHistory: () => {},
  sendRaw: () => {},
  addMessage: () => '',
  clearAdded: () => {},

  mode: 'voice',
  switchMode: async () => {},
  sendTextMessage: async () => {},

  getNextTs: () => Date.now(),
});

export const RealtimeProvider = RealtimeContext.Provider;
export * from './RealtimeContext';

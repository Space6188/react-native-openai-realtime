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
  sendRaw: () => {},
  addMessage: () => '',
  clearAdded: () => {},
});

export const RealtimeProvider = RealtimeContext.Provider;

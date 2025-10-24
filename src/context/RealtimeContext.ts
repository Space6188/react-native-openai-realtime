import { createContext, useContext } from 'react';
import type { ChatMsg } from '@react-native-openai-realtime/types';
import type { RealtimeClient } from '@react-native-openai-realtime/components/RealtimeClientClass';

export type RealtimeContextValue = {
  client: RealtimeClient | null;
  isConnected: boolean;
  isConnecting: boolean;
  chat: ChatMsg[];
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
});

export const RealtimeProvider = RealtimeContext.Provider;

export function useRealtime() {
  return useContext(RealtimeContext);
}

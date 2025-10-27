import { AddableMessage, ExtendedChatMsg } from './Chat';
import { RealtimeClient } from '@react-native-openai-realtime/components/RealtimeClientClass';

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
  addMessage: (m: AddableMessage | AddableMessage[]) => string | string[];
  clearAdded: () => void;
};

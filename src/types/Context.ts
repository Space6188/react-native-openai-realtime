import { AddableMessage, ExtendedChatMsg } from './Chat';
import type { RealtimeStatus } from '@react-native-openai-realtime/types';
import type { RealtimeClientClass } from '@react-native-openai-realtime/components/RealtimeClientClass';

export type RealtimeContextValue = {
  client: RealtimeClientClass | null;
  status: RealtimeStatus;
  clearChatHistory: () => void;
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

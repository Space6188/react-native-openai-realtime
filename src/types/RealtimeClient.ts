import { RealtimeContextValue } from '@react-native-openai-realtime/context/RealtimeContext';
import { RealtimeClientOptions } from '.';

import type { IncomingMiddleware, OutgoingMiddleware } from './index';

export type RealTimeClientProps = {
  // ВЕРХНЕУРОВНЕВЫЕ ПРОПЫ (всё опционально)
  // Базовые
  tokenProvider?: RealtimeClientOptions['tokenProvider'];
  voice?: RealtimeClientOptions['voice'];
  webrtc?: RealtimeClientOptions['webrtc'];
  media?: RealtimeClientOptions['media'];
  session?: RealtimeClientOptions['session'];
  autoSessionUpdate?: RealtimeClientOptions['autoSessionUpdate'];

  // Greet (сахар над greet.enabled/response)
  greetEnabled?: boolean;
  greetInstructions?: string;
  greetModalities?: Array<'audio' | 'text'>;

  // Hooks (верхнеуровневые, вместо options.hooks)
  onOpen?: RealtimeClientOptions['hooks'] extends infer H
    ? H extends { onOpen: infer F }
      ? F
      : never
    : never;
  onEvent?: RealtimeClientOptions['hooks'] extends infer H
    ? H extends { onEvent: infer F }
      ? F
      : never
    : never;
  onError?: RealtimeClientOptions['hooks'] extends infer H
    ? H extends { onError: infer F }
      ? F
      : never
    : never;
  onUserTranscriptionDelta?: RealtimeClientOptions['hooks'] extends infer H
    ? H extends { onUserTranscriptionDelta: infer F }
      ? F
      : never
    : never;
  onUserTranscriptionCompleted?: RealtimeClientOptions['hooks'] extends infer H
    ? H extends { onUserTranscriptionCompleted: infer F }
      ? F
      : never
    : never;
  onAssistantTextDelta?: RealtimeClientOptions['hooks'] extends infer H
    ? H extends { onAssistantTextDelta: infer F }
      ? F
      : never
    : never;
  onAssistantCompleted?: RealtimeClientOptions['hooks'] extends infer H
    ? H extends { onAssistantCompleted: infer F }
      ? F
      : never
    : never;
  onToolCall?: RealtimeClientOptions['hooks'] extends infer H
    ? H extends { onToolCall: infer F }
      ? F
      : never
    : never;

  // Middleware
  incomingMiddleware?: IncomingMiddleware[];
  outgoingMiddleware?: OutgoingMiddleware[];

  // Политики/чат
  policyIsMeaningfulText?: NonNullable<
    RealtimeClientOptions['policy']
  >['isMeaningfulText'];
  chatEnabled?: NonNullable<RealtimeClientOptions['chat']>['enabled'];
  chatIsMeaningfulText?: NonNullable<
    RealtimeClientOptions['chat']
  >['isMeaningfulText'];

  // Логгер
  logger?: RealtimeClientOptions['logger'];

  // Управление внешним поведением обёртки
  autoConnect?: boolean; // default: true
  attachChat?: boolean; // default: true
  children?: React.ReactNode | ((ctx: RealtimeContextValue) => React.ReactNode);
};

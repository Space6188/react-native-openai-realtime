import type { RTCOfferOptions } from 'react-native-webrtc/lib/typescript/RTCUtil';
import { VOICE_IDS, VoiceId } from '@react-native-openai-realtime/helpers';
import type {
  RealtimeContextValue,
  Constraints,
  ChatOptions,
  RealtimeSuccessCallbacks,
  RealtimeErrorCallbacks,
} from '@react-native-openai-realtime/types';
import { RealtimeClientClass } from '@react-native-openai-realtime/components';

export type RTCIceServer = {
  credential?: string;
  url?: string;
  urls?: string | string[];
  username?: string;
};

export type RTCConfiguration = {
  bundlePolicy?: 'balanced' | 'max-compat' | 'max-bundle';
  iceCandidatePoolSize?: number;
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: 'all' | 'relay';
  rtcpMuxPolicy?: 'negotiate' | 'require';
};

export type TokenProvider = () => Promise<string>;

export type ChatMode = 'voice' | 'text';

export type SessionConfig = {
  model?: string;
  voice?: VoiceId;
  modalities?: Array<'audio' | 'text'>;
  turn_detection?: {
    type: 'server_vad';
    silence_duration_ms?: number;
    threshold?: number;
    prefix_padding_ms?: number;
  } | null;
  input_audio_transcription?: { model: string; language?: string };
  tools?: any[];
  instructions?: string;
};

export type RealtimeClientHooks = {
  onOpen?: (dc: any) => void;
  onEvent?: (evt: any) => void;
  onError?: (e: any) => void;

  onUserTranscriptionDelta?: (payload: {
    itemId: string;
    delta: string;
  }) => 'consume' | void;
  onUserTranscriptionCompleted?: (payload: {
    itemId: string;
    transcript: string;
  }) => 'consume' | void;

  onAssistantTextDelta?: (payload: {
    responseId: string;
    delta: string;
    channel: 'audio_transcript' | 'output_text';
  }) => 'consume' | void;

  onAssistantCompleted?: (payload: {
    responseId: string;
    status: 'done' | 'canceled';
  }) => 'consume' | void;

  onToolCall?: (payload: {
    name: string;
    args: any;
    call_id: string;
  }) => Promise<any> | any;
};

export type MiddlewareCtx = {
  event: any;
  send: (e: any) => void | Promise<void>;
  client: RealtimeClientClass;
};

export type IncomingMiddleware = (
  ctx: MiddlewareCtx
) => Promise<any | 'stop' | null | void> | any | 'stop' | null | void;

export type OutgoingMiddleware = (
  event: any
) => any | null | 'stop' | Promise<any | null | 'stop'>;

export type Logger = {
  debug?: (...a: any[]) => void;
  info?: (...a: any[]) => void;
  warn?: (...a: any[]) => void;
  error?: (...a: any[]) => void;
};

export type RealtimeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'user_speaking'
  | 'assistant_speaking';

export type RealtimeClientOptionsBeforePrune = {
  deleteChatHistoryOnDisconnect?: boolean;
  tokenProvider: TokenProvider;
  voice?: keyof typeof VOICE_IDS;
  webrtc?: {
    iceServers?: RTCIceServer[];
    dataChannelLabel?: string;
    offerOptions?: RTCOfferOptions & { voiceActivityDetection?: boolean };
    configuration?: RTCConfiguration;
  };
  media?: { getUserMedia?: Constraints };
  session?: Partial<SessionConfig>;
  autoSessionUpdate?: boolean;
  greet?: {
    enabled?: boolean;
    response?: {
      instructions?: string;
      modalities?: Array<'audio' | 'text'>;
    };
  };
  hooks?: RealtimeClientHooks;
  middleware?: {
    incoming?: IncomingMiddleware[];
    outgoing?: OutgoingMiddleware[];
  };
  policy?: {
    isMeaningfulText?: (text: string) => boolean;
  };
  chat?: ChatOptions;
  logger?: Logger;
  allowConnectWithoutMic?: boolean;
};

/**
 * ОБНОВЛЕНО: Добавлены все Success и Error коллбэки в публичные пропсы
 */
export type RealTimeClientProps = RealtimeSuccessCallbacks &
  RealtimeErrorCallbacks & {
    // Быстрые чат-поведения
    chatUserAddOnDelta?: boolean;
    chatInverted?: boolean;
    deleteChatHistoryOnDisconnect?: boolean;
    chatUserPlaceholderOnStart?: boolean;
    chatAssistantAddOnDelta?: boolean;
    chatAssistantPlaceholderOnStart?: boolean;

    tokenProvider?: TokenProvider;

    webrtc?: {
      iceServers?: RTCIceServer[];
      dataChannelLabel?: string;
      offerOptions?: RTCOfferOptions & { voiceActivityDetection?: boolean };
      configuration?: RTCConfiguration;
    };

    media?: { getUserMedia?: Constraints };
    session?: Partial<SessionConfig>;
    autoSessionUpdate?: boolean;

    // Greet настройки
    greetEnabled?: boolean;
    greetInstructions?: string;
    greetModalities?: Array<'audio' | 'text'>;

    // Hooks
    onOpen?: RealtimeClientHooks['onOpen'];
    onEvent?: RealtimeClientHooks['onEvent'];
    // onError уже в RealtimeErrorCallbacks
    onUserTranscriptionDelta?: RealtimeClientHooks['onUserTranscriptionDelta'];
    onUserTranscriptionCompleted?: RealtimeClientHooks['onUserTranscriptionCompleted'];
    onAssistantTextDelta?: RealtimeClientHooks['onAssistantTextDelta'];
    onAssistantCompleted?: RealtimeClientHooks['onAssistantCompleted'];
    onToolCall?: RealtimeClientHooks['onToolCall'];

    // Middleware
    incomingMiddleware?: IncomingMiddleware[];
    outgoingMiddleware?: OutgoingMiddleware[];

    // Policy/chat
    policyIsMeaningfulText?: (text: string) => boolean;
    chatEnabled?: boolean;
    chatIsMeaningfulText?: (text: string) => boolean;
    logger?: Logger;
    autoConnect?: boolean;
    attachChat?: boolean;

    // Режимы
    initialMode?: ChatMode;
    onModeChange?: (mode: ChatMode) => void;

    allowConnectWithoutMic?: boolean;

    children?:
      | React.ReactNode
      | ((ctx: RealtimeContextValue) => React.ReactNode);
  };

export type CoreConfig = Omit<
  RealTimeClientProps,
  'autoConnect' | 'attachChat' | 'children' | 'initialMode' | 'onModeChange'
>;

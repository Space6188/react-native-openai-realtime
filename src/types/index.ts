import type { RTCOfferOptions } from 'react-native-webrtc/lib/typescript/RTCUtil';
import { VOICE_IDS } from '@react-native-openai-realtime/helpers/voice';
import { ResponseCreateParams } from '@react-native-openai-realtime/types/Responce';
import { Constraints } from '@react-native-openai-realtime/types/Constraints';
import { RealtimeClient } from '@react-native-openai-realtime/components/RealtimeClientClass';

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

export type SessionConfig = {
  model?: string;
  voice?: (typeof VOICE_IDS)[number];
  modalities?: Array<'audio' | 'text'>;
  turn_detection?: {
    type: 'server_vad';
    silence_duration_ms?: number;
    threshold?: number;
    prefix_padding_ms?: number;
  };
  input_audio_transcription?: {
    model: string;
    language?: string;
  };
  tools?: any[];
  instructions?: string;
};

export type RealtimeClientHooks = {
  onOpen?: (dc: any) => void;
  onEvent?: (evt: any) => void;
  onError?: (e: any) => void;

  // Возврат 'consume' — перехват дефолтного поведения (опционально)
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
  client: RealtimeClient | null;
};
export type IncomingMiddleware = (
  ctx: MiddlewareCtx
) => Promise<any | 'stop' | null | void> | any | 'stop' | null | void;
export type OutgoingMiddleware = (
  event: any
) => any | null | 'stop' | Promise<any | null | 'stop'>;

export type ChatOptions = {
  enabled?: boolean; // по умолчанию true — встроенный чат-стор включён
  isMeaningfulText?: (text: string) => boolean;
};

export type RealtimeClientOptions = {
  tokenProvider: TokenProvider;

  voice?: (typeof VOICE_IDS)[number];
  webrtc?: {
    iceServers?: RTCIceServer[];
    dataChannelLabel?: string;
    offerOptions?: RTCOfferOptions & { voiceActivityDetection?: boolean };
    configuration?: RTCConfiguration;
  };

  media?: {
    getUserMedia?: Constraints;
  };

  session?: Partial<SessionConfig>;
  autoSessionUpdate?: boolean;

  greet?: {
    enabled?: boolean; // default: true
    response?: Partial<ResponseCreateParams>; // если не указали instructions — подставим дефолт
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

  logger?: {
    debug?: (...a: any[]) => void;
    info?: (...a: any[]) => void;
    warn?: (...a: any[]) => void;
    error?: (...a: any[]) => void;
  };
};

// Для чата (используется в ChatStore/ChatAdapter)
export type ChatMsg = {
  id: string;
  time: number;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  status: 'streaming' | 'done' | 'canceled';
  responseId?: string;
  itemId?: string;
};

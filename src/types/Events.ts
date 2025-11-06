// src/types/Events.ts

/**
 * Типы всех событий, которые можно слушать через client.on()
 */
export type RealtimeEventMap = {
  // User events (пользовательский ввод)
  'user:item_started': { itemId: string };
  'user:delta': { itemId: string; delta: string };
  'user:completed': { itemId: string; transcript: string };
  'user:failed': { itemId: string; error?: any };
  'user:truncated': { itemId: string };

  // Assistant events (ответы ассистента)
  'assistant:response_started': { responseId: string };
  'assistant:item_started': { itemId: string };
  'assistant:delta': {
    responseId: string;
    delta: string;
    channel?: 'audio_transcript' | 'output_text';
  };
  'assistant:completed': { responseId: string; status: 'done' | 'canceled' };

  // Tool events (вызовы функций)
  'tool:call_delta': { call_id: string; name: string; delta: string };
  'tool:call_done': { call_id: string; name: string; args: any };

  // Speech activity events (определение речи)
  'speech_started': void;
  'speech_stopped': void;
  'timeout_triggered': void;

  // Buffer events (буферы аудио)
  'input_audio_buffer.committed': any;
  'input_audio_buffer.cleared': any;
  'output_audio_buffer.started': any;
  'output_audio_buffer.stopped': any;
  'output_audio_buffer.cleared': any;

  // DataChannel events (низкоуровневые)
  'dataChannelOpen': any;
  'dataChannelMessage': any;
  'dataChannelClose': void;

  // Error events
  'error': { scope: 'tool' | 'server' | string; error: any };

  // Raw server events (любое серверное событие)
  [key: string]: any;
};

/**
 * Типизированный слушатель событий
 */
export type RealtimeEventListener<K extends keyof RealtimeEventMap> = (
  payload: RealtimeEventMap[K]
) => void;

/**
 * Коллбэки для всех Success событий (полный список)
 */
export interface RealtimeSuccessCallbacks {
  // Connection lifecycle
  onHangUpStarted?: () => void;
  onHangUpDone?: () => void;

  // PeerConnection events
  onPeerConnectionCreatingStarted?: () => void;
  onPeerConnectionCreated?: (pc: any) => void;
  onRTCPeerConnectionStateChange?: (
    state:
      | 'new'
      | 'connecting'
      | 'connected'
      | 'disconnected'
      | 'failed'
      | 'closed'
  ) => void;

  // Media events
  onGetUserMediaSetted?: (stream: any) => void;
  onLocalStreamSetted?: (stream: any) => void;
  onLocalStreamAddedTrack?: (track: any) => void;
  onLocalStreamRemovedTrack?: (track: any) => void;
  onRemoteStreamSetted?: (stream: any) => void;

  // DataChannel events
  onDataChannelOpen?: (channel: any) => void;
  onDataChannelMessage?: (message: any) => void;
  onDataChannelClose?: () => void;

  // ICE events
  onIceGatheringComplete?: () => void;
  onIceGatheringTimeout?: () => void;
  onIceGatheringStateChange?: (state: string) => void;

  // Permission events
  onMicrophonePermissionGranted?: () => void;
  onMicrophonePermissionDenied?: () => void;

  // iOS specific
  onIOSTransceiverSetted?: () => void;

  // Generic success handler
  onSuccess?: (stage: string, data?: any) => void;
}

/**
 * Коллбэки для Error событий
 */
export type ErrorCallbackPayload = {
  stage: string;
  error: Error;
  severity: 'critical' | 'warning' | 'info';
  recoverable: boolean;
  timestamp: number;
  context?: Record<string, any>;
};
export interface RealtimeErrorCallbacks {
  onError?: (event: ErrorCallbackPayload) => void;
}

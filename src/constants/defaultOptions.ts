import type { RealtimeClientOptionsBeforePrune } from '@react-native-openai-realtime/types';

export const DEFAULTS: RealtimeClientOptionsBeforePrune = {
  // tokenProvider — обязателен, без него нельзя получить ephemeral token
  tokenProvider: async () => {
    throw new Error(
      'tokenProvider is required: provide a function returning ephemeral token'
    );
  },

  webrtc: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    dataChannelLabel: 'oai-events',
    offerOptions: {
      offerToReceiveAudio: true,
      voiceActivityDetection: true,
    } as any,
    configuration: { iceCandidatePoolSize: 10 },
  },

  media: {
    getUserMedia: {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } as any,
      video: false,
    },
  },

  session: {
    model: 'gpt-4o-realtime-preview-2024-12-17',
    voice: 'alloy',
    modalities: ['audio', 'text'],
    input_audio_transcription: { model: 'whisper-1' },
    turn_detection: {
      type: 'server_vad',
      silence_duration_ms: 700,
      prefix_padding_ms: 300,
      threshold: 0.5,
    },
  },

  autoSessionUpdate: true,

  greet: {
    enabled: true,
    response: {
      instructions: 'Привет! Я на связи и готов помочь.',
      modalities: ['audio', 'text'],
    },
  },

  hooks: {},

  middleware: {
    incoming: [],
    outgoing: [],
  },

  policy: {
    isMeaningfulText: (t: string) => !!t.trim(),
  },

  chat: {
    enabled: true,
    isMeaningfulText: (t: string) => !!t.trim(),
  },

  logger: {
    info: (...a) => console.log('[INFO]', ...a),
    debug: (...a) => console.log('[DEBUG]', ...a),
    warn: (...a) => console.log('[WARN]', ...a),
    error: (...a) => console.log('[ERROR]', ...a),
  },
};

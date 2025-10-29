import React, {useCallback, useMemo, useState} from 'react';
import {
  RealTimeClient,
  createSpeechActivityMiddleware,
} from 'react-native-openai-realtime';
import type {
  IncomingMiddleware,
  OutgoingMiddleware,
  RealtimeClientHooks,
} from 'react-native-openai-realtime';
import {get_time, get_weather, set_reminder} from '../utils/toolkit';

const SERVER_BASE = 'http://localhost:8787';

const tokenProvider = async () => {
  const r = await fetch(`${SERVER_BASE}/realtime/session`);
  const j = await r.json();
  return j?.client_secret?.value;
};

// Incoming middleware
const incomingMiddleware: IncomingMiddleware[] = [
  createSpeechActivityMiddleware(),
  async ({event}) => {
    if (
      event?.type === 'response.output_text.delta' &&
      typeof event.delta === 'string'
    ) {
      event.delta = event.delta.replace(/\s+/g, ' ');
      return event;
    }
    return;
  },
];

// Outgoing middleware
const outgoingMiddleware: OutgoingMiddleware[] = [
  event => {
    if (event?.type === 'response.create') {
      event.response = event.response || {};
      event.response.modalities = event.response.modalities ?? [
        'text',
        'audio',
      ];
      event.response.instructions = `[KitchenSink] ${
        event.response.instructions || ''
      }`;
      return event;
    }
    if (
      event?.type === 'conversation.item.create' &&
      event.item?.content?.[0]?.type === 'input_text'
    ) {
      const txt = String(event.item.content[0].text || '');
      event.item.content[0].text = txt.trim();
      if (!txt.trim()) {
        return 'stop';
      }
      return event;
    }
    return event;
  },
];

export default function App() {
  // onEvent лог — без выделенного контекста
  const [_events, setEvents] = useState<
    Array<{t: number; type: string; raw: any}>
  >([]);
  const pushEvent = useCallback((evt: any) => {
    setEvents(prev =>
      [{t: Date.now(), type: String(evt?.type || ''), raw: evt}, ...prev].slice(
        0,
        300,
      ),
    );
  }, []);
  //   const clearEvents = useCallback(() => setEvents([]), []);
  const onOpen = useCallback(
    (dc: any) => console.log('[onOpen]', dc?.label),
    [],
  );
  const onUserTranscriptionDelta = useCallback(
    ({itemId, delta}: RealtimeClientHooks['onUserTranscriptionDelta']) => {
      console.log('[user.delta]', itemId, delta);
      if (/^(эм+|мм+|ээ+|угу+|ага+)\.?$/i.test(delta.trim())) {
        return 'consume';
      }
    },
    [],
  );
  const onUserTranscriptionCompleted = useCallback(
    ({
      itemId,
      transcript,
    }: RealtimeClientHooks['onUserTranscriptionCompleted']) => {
      console.log('[user.completed]', itemId, transcript);
    },
    [],
  );
  const onAssistantTextDelta = useCallback(
    ({
      responseId,
      delta,
      channel,
    }: RealtimeClientHooks['onAssistantTextDelta']) => {
      console.log('[assistant.delta]', responseId, delta, channel);
      if (!delta.replace(/[^\p{L}\p{N}]+/gu, '').trim()) {
        return 'consume';
      }
    },
    [],
  );
  const onAssistantCompleted = useCallback(
    ({responseId, status}: RealtimeClientHooks['onAssistantCompleted']) => {
      console.log('[assistant.completed]', responseId, status);
    },
    [],
  );
  const toolsSpec = useMemo(
    () => [
      {
        type: 'function',
        name: 'get_time',
        description: 'Return current ISO date-time',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'get_weather',
        description: 'Return (mock) weather for city',
        parameters: {
          type: 'object',
          properties: {city: {type: 'string', description: 'City name'}},
          required: ['city'],
          additionalProperties: false,
        },
      },
      {
        type: 'function',
        name: 'set_reminder',
        description: 'Schedule simple reminder',
        parameters: {
          type: 'object',
          properties: {text: {type: 'string'}, minutes: {type: 'number'}},
          required: ['text'],
          additionalProperties: false,
        },
      },
    ],
    [],
  );

  const onToolCall = useCallback(
    async ({name, args}: {name: string; args: any}) => {
      if (name === 'get_time') {
        return await get_time();
      }
      if (name === 'get_weather') {
        return await get_weather(args);
      }
      if (name === 'set_reminder') {
        return await set_reminder(args);
      }
    },
    [],
  );

  return (
    <RealTimeClient
      tokenProvider={tokenProvider}
      // webrtc/media
      webrtc={{
        iceServers: [
          {urls: 'stun:stun.l.google.com:19302'},
          {urls: 'stun:stun1.l.google.com:19302'},
        ],
        dataChannelLabel: 'oai-events',
        offerOptions: {
          offerToReceiveAudio: true,
          voiceActivityDetection: true,
        } as any,
        configuration: {iceCandidatePoolSize: 16},
      }}
      media={{
        getUserMedia: {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          } as any,
          video: false,
        },
      }}
      // session
      session={{
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'alloy',
        modalities: ['audio', 'text'],
        input_audio_transcription: {model: 'whisper-1', language: 'ru'},
        turn_detection: {
          type: 'server_vad',
          silence_duration_ms: 700,
          prefix_padding_ms: 300,
          threshold: 0.5,
        },
        tools: toolsSpec,
        instructions:
          'Ты — аккуратный ассистент. Говори кратко. Если нужна функция — вызывай tool.',
      }}
      autoSessionUpdate={true}
      // greet
      greetEnabled={true}
      greetInstructions="Привет! Я на связи и готов помочь."
      greetModalities={['audio', 'text']}
      // hooks
      onEvent={pushEvent}
      onOpen={onOpen}
      onUserTranscriptionDelta={onUserTranscriptionDelta}
      onUserTranscriptionCompleted={onUserTranscriptionCompleted}
      onAssistantTextDelta={onAssistantTextDelta}
      onAssistantCompleted={onAssistantCompleted}
      onToolCall={onToolCall}
      onError={(e: any) => console.warn('onError:', e)}
      // middleware
      incomingMiddleware={incomingMiddleware}
      outgoingMiddleware={outgoingMiddleware}
      // policy/chat
      policyIsMeaningfulText={(t: string) =>
        t.replace(/[^\p{L}\p{N}]+/gu, '').trim().length >= 2
      }
      chatEnabled={true}
      chatIsMeaningfulText={(t: string) => !!t.trim()}
      // прочее
      deleteChatHistoryOnDisconnect={false}
      logger={{
        info: (...a: any[]) => console.log('[INFO]', ...a),
        debug: (...a: any[]) => console.log('[DEBUG]', ...a),
        warn: (...a: any[]) => console.log('[WARN]', ...a),
        error: (...a: any[]) => console.log('[ERROR]', ...a),
      }}
      autoConnect={false}
      attachChat={true}>
      {/* Here you can put your own components or throw them to the children prop*/}
      {/* <SafeAreaView style={{flex: 1}}>
        <StatusBar barStyle="dark-content" />
        <KitchenSinkRealtimeDemo
        events={events}
        onClearEvents={clearEvents}
        />
    </SafeAreaView> */}
    </RealTimeClient>
  );
}

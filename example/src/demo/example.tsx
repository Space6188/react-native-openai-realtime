import React, {useCallback, useMemo, useRef, useState} from 'react';
import {SafeAreaView, StatusBar, View, Text, Switch} from 'react-native';
import {
  RealTimeClient,
  createSpeechActivityMiddleware,
  type IncomingMiddleware,
  type OutgoingMiddleware,
  type RealtimeContextValue,
  type RealtimeClientHooks,
} from 'react-native-openai-realtime';
import {KitchenSinkRealtimeDemo} from './src/demo/KitchenSinkRealtimeDemo';

// Конфиг сервера (получение эфемерного токена)
const SERVER_BASE = 'http://localhost:8787';

// 1) tokenProvider — эфемерный ключ от вашего бэкенда
const tokenProvider = async () => {
  const r = await fetch(`${SERVER_BASE}/realtime/session`);
  const j = await r.json();
  return j?.client_secret?.value;
};

// 2) incoming middleware
const incomingMiddleware: IncomingMiddleware[] = [
  createSpeechActivityMiddleware(),
  async ({event}: any) => {
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

// 3) outgoing middleware
const outgoingMiddleware: OutgoingMiddleware[] = [
  (event: any) => {
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
      if (!txt.trim()) return 'stop';
      return event;
    }
    return event;
  },
];

export default function App() {
  // 4) Лог onEvent
  const [events, setEvents] = useState<
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
  const clearEvents = useCallback(() => setEvents([]), []);

  // 5) addMessage из контекста (для onToolCall при желании)
  const addMessageRef = useRef<RealtimeContextValue['addMessage'] | null>(null);

  // 6) Hook callbacks
  const onOpen = useCallback(
    (dc: any) => console.log('[onOpen]', dc?.label),
    [],
  );
  const onUserTranscriptionDelta = useCallback(
    ({itemId, delta}: RealtimeClientHooks['onUserTranscriptionDelta']) => {
      console.log('[user.delta]', itemId, delta);
      if (/^(эм+|мм+|ээ+|угу+|ага+)\.?$/i.test(delta.trim())) return 'consume';
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
      if (
        !String(delta)
          .replace(/[^\p{L}\p{N}]+/gu, '')
          .trim()
      )
        return 'consume';
    },
    [],
  );
  const onAssistantCompleted = useCallback(
    ({responseId, status}: RealtimeClientHooks['onAssistantCompleted']) => {
      console.log('[assistant.completed]', responseId, status);
    },
    [],
  );

  // Демо: переключатель chatInverted
  const [chatInverted, setChatInverted] = useState(false);

  // 7) Пример набора tools (консистентный формат)
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

  // 8) onToolCall (простая заглушка; можно заменить на реальные вызовы)
  const onToolCall = useCallback(
    async ({name, args}: {name: string; args: any}) => {
      if (name === 'get_time') {
        return {now: new Date().toISOString()};
      }
      if (name === 'get_weather') {
        const city = args?.city || 'Unknown';
        return {
          city,
          temp_c: Math.round(10 + Math.random() * 15),
          condition: 'Sunny',
          feels_like_c: Math.round(9 + Math.random() * 12),
        };
      }
      if (name === 'set_reminder') {
        return {
          ok: true,
          scheduled_in_minutes: args?.minutes ?? 10,
          text: args?.text,
        };
      }
      return undefined;
    },
    [],
  );

  return (
    <RealTimeClient
      tokenProvider={tokenProvider}
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
      autoSessionUpdate
      greetEnabled
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
      onError={e => console.warn('onError:', e)}
      // middleware
      incomingMiddleware={incomingMiddleware}
      outgoingMiddleware={outgoingMiddleware}
      // policy/chat
      policyIsMeaningfulText={t =>
        t.replace(/[^\p{L}\p{N}]+/gu, '').trim().length >= 2
      }
      chatEnabled
      chatIsMeaningfulText={t => !!t.trim()}
      chatInverted={chatInverted}
      deleteChatHistoryOnDisconnect={false}
      logger={{
        info: (...a) => console.log('[INFO]', ...a),
        debug: (...a) => console.log('[DEBUG]', ...a),
        warn: (...a) => console.log('[WARN]', ...a),
        error: (...a) => console.log('[ERROR]', ...a),
      }}
      autoConnect={false}
      attachChat>
      {ctx => {
        // Прокинем addMessage в ref, если нужно класть свои UI-пузыри из колбеков
        addMessageRef.current = ctx.addMessage;

        return (
          <SafeAreaView style={{flex: 1}}>
            <StatusBar barStyle="dark-content" />
            <View style={{paddingHorizontal: 12, paddingTop: 8}}>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <Text style={{fontWeight: '600', marginRight: 8}}>
                  chatInverted
                </Text>
                <Switch value={chatInverted} onValueChange={setChatInverted} />
              </View>
            </View>
            <KitchenSinkRealtimeDemo
              events={events}
              onClearEvents={clearEvents}
            />
          </SafeAreaView>
        );
      }}
    </RealTimeClient>
  );
}

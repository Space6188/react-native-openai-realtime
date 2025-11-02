/**
 * GlobalRealtimeProvider - Глобальный провайдер для всего приложения
 *
 * Рекомендации:
 * - Используйте один провайдер на верхнем уровне приложения
 * - ref позволяет добавлять UI-сообщения из onToolCall
 * - Настройте токен-провайдер и tools под свои нужды
 * - Включите Success callbacks для мониторинга
 */

import React, {useCallback, useMemo, useRef} from 'react';
import {
  RealTimeClient,
  createSpeechActivityMiddleware,
  type RealTimeClientHandle,
  type IncomingMiddleware,
  type OutgoingMiddleware,
} from 'react-native-openai-realtime';

// ==================== Configuration ====================

const SERVER_BASE = 'http://localhost:8787';

const tokenProvider = async () => {
  const r = await fetch(`${SERVER_BASE}/realtime/session`);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Failed to fetch token: ${r.status} ${text}`);
  }
  const j = await r.json();
  return j.client_secret.value;
};

// ==================== Middleware ====================

// Incoming middleware: фильтрация пустых дельт и междометий
const createIncomingMiddleware = (): IncomingMiddleware[] => [
  // 1. Speech activity tracker (обязательно первым)
  createSpeechActivityMiddleware(),

  // 2. Фильтрация "мусорных" междометий
  async ({event}) => {
    if (event?.type === 'conversation.item.input_audio_transcription.delta') {
      const delta = event?.delta?.trim() || '';
      // Блокируем короткие междометия типа "эм", "мм", "ээ"
      if (/^(эм+|мм+|ээ+|ага+|угу+|хм+)\.?$/i.test(delta)) {
        console.log('🚫 Filtered filler:', delta);
        return 'stop';
      }
    }

    // Фильтрация пустых дельт ассистента
    if (
      event?.type === 'response.text.delta' ||
      event?.type === 'response.audio_transcript.delta'
    ) {
      if (!event?.delta?.trim()) {
        return 'stop';
      }
    }

    return; // Пропускаем дальше
  },

  // 3. Логирование важных событий (опционально)
  async ({event}) => {
    const important = new Set([
      'conversation.item.created',
      'response.created',
      'response.done',
      'error',
    ]);

    if (important.has(event?.type)) {
      console.log('📨', event.type);
    }

    return;
  },
];

// Outgoing middleware: валидация и метаданные
const createOutgoingMiddleware = (): OutgoingMiddleware[] => [
  // 1. Очистка пустых текстовых сообщений
  event => {
    if (
      event?.type === 'conversation.item.create' &&
      event.item?.content?.[0]?.type === 'input_text'
    ) {
      const text = (event.item.content[0].text || '').trim();
      if (!text) {
        console.warn('⚠️ Blocked empty text message');
        return 'stop';
      }
      event.item.content[0].text = text;
    }
    return event;
  },

  // 2. Добавление метаданных к response.create (опционально)
  event => {
    if (event?.type === 'response.create') {
      const instructions = event.response?.instructions || '';
      if (instructions && !instructions.includes('[App]')) {
        return {
          ...event,
          response: {
            ...event.response,
            instructions: `[App] ${instructions}`,
          },
        };
      }
    }
    return event;
  },
];

// ==================== Tools Spec ====================

const toolsSpec = [
  {
    type: 'function' as const,
    name: 'search_flights',
    description: 'Search for available flights between cities',
    parameters: {
      type: 'object',
      properties: {
        from: {type: 'string', description: 'Departure city'},
        to: {type: 'string', description: 'Destination city'},
        date: {type: 'string', description: 'Date in YYYY-MM-DD format'},
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    name: 'search_professionals',
    description: 'Search for professionals or services',
    parameters: {
      type: 'object',
      properties: {
        query: {type: 'string', description: 'Search query'},
        category: {type: 'string', description: 'Category filter'},
        location: {type: 'string', description: 'Location filter'},
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    name: 'get_weather',
    description: 'Get current weather for a city',
    parameters: {
      type: 'object',
      properties: {
        city: {type: 'string', description: 'City name'},
      },
      required: ['city'],
      additionalProperties: false,
    },
  },
];

// ==================== Provider Component ====================

export const GlobalRealtimeProvider: React.FC<{
  children: React.ReactNode;
}> = ({children}) => {
  const rtcRef = useRef<RealTimeClientHandle | null>(null);

  // ==================== Middleware ====================

  const incomingMiddleware = useMemo(() => createIncomingMiddleware(), []);
  const outgoingMiddleware = useMemo(() => createOutgoingMiddleware(), []);

  // ==================== Callbacks ====================

  // onOpen - вызывается при открытии DataChannel
  const onOpen = useCallback(async (dc: RTCDataChannel) => {
    console.log('🎉 DataChannel opened:', dc?.label);

    // Получаем клиента
    const client = rtcRef.current?.getClient();
    if (!client) return;

    // Опционально: инициализация режима
    // await rtcRef.current?.sendRaw({
    //   type: 'session.update',
    //   session: {
    //     modalities: ['text'],
    //     turn_detection: null,
    //   },
    // });

    // Восстановление истории чата (если нужно)
    const chatHistory = client.getChat?.() || [];
    const last12 = chatHistory.filter(m => m.type === 'text').slice(-12);
    if (last12.length) {
      console.log(`📜 Restored ${last12.length} messages from history`);
    }

    console.log('✅ Provider ready');
  }, []);

  // onError - централизованная обработка ошибок
  const onError = useCallback((errorEvent: any) => {
    if (errorEvent?.stage) {
      console.error(
        `❌ Error at ${errorEvent.stage}:`,
        errorEvent.error?.message || errorEvent.error,
      );
      console.error('Severity:', errorEvent.severity);
      console.error('Recoverable:', errorEvent.recoverable);
      if (errorEvent.context) {
        console.error('Context:', errorEvent.context);
      }
    } else {
      console.error('❌ Server error:', errorEvent);
    }
  }, []);

  // onEvent - логирование входящих событий
  const onEvent = useCallback((event: any) => {
    // Логируем только важные события
    const important = new Set([
      'session.updated',
      'conversation.item.created',
      'response.created',
      'response.done',
      'error',
    ]);

    if (important.has(event.type)) {
      console.log('📨 Event:', event.type);
    }
  }, []);

  // onToolCall - обработка вызовов функций
  const onToolCall = useCallback(
    async ({
      name,
      args,
      call_id,
    }: {
      name: string;
      args: any;
      call_id: string;
    }) => {
      try {
        console.log('🔧 Tool call:', name, args);

        // Определяем тип инструмента
        const isFlights =
          name === 'search_flights' || name === 'SearchTripByAirplane';
        const isPros =
          name === 'search_professionals' || name === 'SearchProfessionals';
        const isWeather = name === 'get_weather';

        if (!isFlights && !isPros && !isWeather) {
          return undefined; // Неизвестный tool - библиотека не отправит output
        }

        // Вызов API
        let url: string;
        let data: any;

        if (isFlights) {
          url = `${SERVER_BASE}/api/search_flights`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(args ?? {}),
          });
          data = await resp.json();

          // Добавляем UI-карточку через ref
          rtcRef.current?.addMessage({
            type: 'ui',
            role: 'assistant',
            kind: 'flights',
            payload: {
              total: Number(data?.total ?? 0),
              items: Array.isArray(data?.items) ? data.items : [],
            },
          });
        } else if (isPros) {
          url = `${SERVER_BASE}/api/search`;
          const resp = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(args ?? {}),
          });
          data = await resp.json();

          rtcRef.current?.addMessage({
            type: 'ui',
            role: 'assistant',
            kind: 'professionals',
            payload: {
              total: Number(data?.total ?? 0),
              items: Array.isArray(data?.items) ? data.items : [],
            },
          });
        } else if (isWeather) {
          // Mock weather API
          data = {
            city: args.city,
            temperature: Math.round(15 + Math.random() * 15),
            condition: 'Sunny',
            humidity: Math.round(40 + Math.random() * 30),
          };

          rtcRef.current?.addMessage({
            type: 'ui',
            role: 'assistant',
            kind: 'weather',
            payload: data,
          });
        }

        // Возвращаем результат - библиотека автоматически:
        // 1. Отправит function_call_output
        // 2. Сделает response.create
        return data;
      } catch (e: any) {
        console.error('❌ Tool call failed:', e);

        // Добавляем UI-сообщение об ошибке
        rtcRef.current?.addMessage({
          type: 'ui',
          role: 'assistant',
          kind: 'error',
          payload: {error: e?.message || String(e)},
        });

        return {error: e?.message || String(e)};
      }
    },
    [],
  );

  // ==================== Success Callbacks ====================

  const onPeerConnectionCreated = useCallback(
    () => console.log('✅ PeerConnection created'),
    [],
  );

  const onRTCPeerConnectionStateChange = useCallback((state: string) => {
    console.log('🔄 Connection state changed:', state);
  }, []);

  const onLocalStreamSetted = useCallback(
    () => console.log('🎤 Local stream ready'),
    [],
  );

  const onRemoteStreamSetted = useCallback(
    () => console.log('🔊 Remote stream received'),
    [],
  );

  const onIceGatheringComplete = useCallback(
    () => console.log('✅ ICE gathering completed'),
    [],
  );

  const onMicrophonePermissionDenied = useCallback(
    () =>
      console.warn('⚠️ Microphone permission denied - fallback to recvonly'),
    [],
  );

  const onDataChannelOpen = useCallback((dc: RTCDataChannel) => {
    console.log('✅ DataChannel opened:', dc?.label);
  }, []);

  // Universal success callback
  const onSuccess = useCallback((stage: string, data?: any) => {
    const important = new Set([
      'peer_connection_created',
      'data_channel_open',
      'ice_gathering_complete',
    ]);

    if (important.has(stage)) {
      console.log(`✅ [SUCCESS] ${stage}`, data);
    }
  }, []);

  // ==================== Logger ====================

  const logger = useMemo(
    () => ({
      info: (m: string, ...a: any[]) => console.log('ℹ️', m, ...a),
      warn: (m: string, ...a: any[]) => console.warn('⚠️', m, ...a),
      error: (m: string, ...a: any[]) => console.error('❌', m, ...a),
      debug: (m: string, ...a: any[]) => {
        if (__DEV__) console.log('🐛', m, ...a);
      },
    }),
    [],
  );

  // ==================== Render ====================

  return (
    <RealTimeClient
      ref={rtcRef}
      // Token
      tokenProvider={tokenProvider}
      // Session
      session={{
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'shimmer',
        modalities: ['text'], // Стартуем в текстовом режиме
        input_audio_transcription: {
          model: 'whisper-1', // Обязательно для транскрипции!
        },
        turn_detection: null, // В текстовом режиме VAD не нужен
        tools: toolsSpec,
        instructions:
          'Ты дружелюбный AI ассистент. Отвечай кратко и по делу. Используй инструменты когда нужно.',
      }}
      // Greet
      greetEnabled={false} // Отключаем автоприветствие
      // Настройки подключения
      autoConnect={true} // Автоматическое подключение при монтировании
      autoSessionUpdate={false} // Управляем сессией вручную через onOpen
      allowConnectWithoutMic={true} // Разрешить работу без микрофона
      // Callbacks
      onOpen={onOpen}
      onError={onError}
      onEvent={onEvent}
      onToolCall={onToolCall}
      // Success callbacks
      onSuccess={onSuccess}
      onPeerConnectionCreated={onPeerConnectionCreated}
      onRTCPeerConnectionStateChange={onRTCPeerConnectionStateChange}
      onLocalStreamSetted={onLocalStreamSetted}
      onRemoteStreamSetted={onRemoteStreamSetted}
      onDataChannelOpen={onDataChannelOpen}
      onIceGatheringComplete={onIceGatheringComplete}
      onMicrophonePermissionDenied={onMicrophonePermissionDenied}
      // Middleware
      incomingMiddleware={incomingMiddleware}
      outgoingMiddleware={outgoingMiddleware}
      // Policy
      policyIsMeaningfulText={text => text.trim().length >= 2}
      // Chat
      chatEnabled={true}
      chatIsMeaningfulText={text => !!text.trim()}
      chatInverted={false} // false = новые сверху
      chatUserAddOnDelta={true}
      chatAssistantAddOnDelta={true}
      deleteChatHistoryOnDisconnect={false} // Сохраняем историю при reconnect
      attachChat={true} // Прикрепить чат к контексту
      // Logger
      logger={logger}>
      {children}
    </RealTimeClient>
  );
};

export default GlobalRealtimeProvider;

// import React from 'react';
// import {SafeAreaView, StatusBar, StyleSheet} from 'react-native';
// import {GlobalRealtimeProvider} from '../provider/globalProvider';
// import {KitchenSinkRealtimeDemo} from './example';

// export default function App() {
//   return (
//     <GlobalRealtimeProvider>
//       <SafeAreaView style={styles.container}>
//         <StatusBar barStyle="dark-content" />
//         <KitchenSinkRealtimeDemo />
//       </SafeAreaView>
//     </GlobalRealtimeProvider>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//   },
// });

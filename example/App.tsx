import React, {FC, useCallback, useEffect, useState, useMemo} from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
  Button,
  ScrollView,
} from 'react-native';

// ===== 1. КОРРЕКТНЫЕ ИМПОРТЫ ИЗ БИБЛИОТЕКИ =====
import {
  RealTimeClient,
  useRealtime,
  useSpeechActivity,
  useMicrophoneActivity,
  createSpeechActivityMiddleware,
  speechActivityStore,
} from '@react-native-openai-realtime';

import type {
  MiddlewareCtx,
  ExtendedChatMsg,
  IncomingMiddleware,
  OutgoingMiddleware,
} from '@react-native-openai-realtime/types';

// ====================================================================================
// 2. БЕЗОПАСНЫЙ TOKEN PROVIDER
// ====================================================================================

const tokenProvider = async (): Promise<string> => {
  console.log('🔑 [tokenProvider] Запрашиваем эфемерный токен с бэкенда...');
  try {
    const backendUrl = 'http://localhost:3000/api/openai/ephemeral-token';
    const userAuthToken = 'YOUR_APP_USER_JWT_OR_SESSION_TOKEN';

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userAuthToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Ошибка получения токена (статус: ${response.status})`);
    }
    const {token} = await response.json();
    if (!token) {
      throw new Error('Сервер вернул пустой токен');
    }

    console.log('✅ [tokenProvider] Токен успешно получен.');
    return token;
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(
      '❌ [tokenProvider] Не удалось получить токен:',
      errorMessage,
    );
    Alert.alert(
      'Ошибка сети',
      `Не удалось подключиться к серверу для получения токена. Убедитесь, что сервер запущен.\n\n${errorMessage}`,
    );
    throw error;
  }
};

// ====================================================================================
// 3. MIDDLEWARE: ГИБКИЙ ПЕРЕХВАТ И МОДИФИКАЦИЯ
// ====================================================================================

const createIncomingMiddleware = (
  log: (msg: string) => void,
): IncomingMiddleware[] => [
  createSpeechActivityMiddleware(speechActivityStore),
  ({event}: MiddlewareCtx) => {
    log(`[IN] ${event.type}`);
    if (
      event.type === 'response.audio_transcript.delta' &&
      !(event.delta || '').trim()
    ) {
      return 'stop';
    }
  },
];

const createOutgoingMiddleware = (
  log: (msg: string) => void,
): OutgoingMiddleware[] => [
  (event: any) => {
    log(`[OUT] ${event.type}`);
    return {
      ...event,
      client_metadata: {appVersion: '1.0.0', platform: Platform.OS},
    };
  },
];

// ====================================================================================
// 4. UI КОМПОНЕНТЫ ДЛЯ ДЕМОНСТРАЦИИ
// ====================================================================================

const MicrophoneVisualizer: FC = () => {
  const mic = useMicrophoneActivity({mode: 'auto', pollInterval: 100});
  const bars = useMemo(
    () =>
      Array.from({length: 20}, (_, i) => {
        const isActive = mic.level >= (i + 1) / 20;
        return (
          <View
            key={i}
            style={[
              styles.micBar,
              // eslint-disable-next-line react-native/no-inline-styles
              {
                height: 10 + i * 1.5,
                backgroundColor: isActive
                  ? `hsl(${120 - i * 6}, 70%, 50%)`
                  : '#e9ecef',
              },
            ]}
          />
        );
      }),
    [mic.level],
  );
  return (
    <View style={styles.micVisualizer}>
      <Text style={styles.micTitle}>
        {mic.isMicActive ? '🎤 Запись...' : '🔇 Тишина'}
      </Text>
      <View style={styles.micBars}>{bars}</View>
    </View>
  );
};

const ChatMessage: FC<{item: ExtendedChatMsg}> = ({item}) => {
  if (item.type === 'ui' && item.kind === 'weather_card') {
    return (
      <View style={[styles.bubble, styles.weatherCard]}>
        <Text style={styles.weatherIcon}>☀️</Text>
        <View>
          <Text style={styles.weatherCity}>{item.payload.city}</Text>
          <Text style={styles.weatherTemp}>{item.payload.temperature}</Text>
        </View>
      </View>
    );
  }
  const isUser = item.role === 'user';
  return (
    <View
      style={[
        styles.bubble,
        isUser ? styles.userBubble : styles.assistantBubble,
      ]}>
      <Text style={isUser ? styles.userText : styles.assistantText}>
        {item.text}
      </Text>
      {item.status === 'streaming' && (
        // eslint-disable-next-line react-native/no-inline-styles
        <ActivityIndicator size="small" style={{marginLeft: 8}} />
      )}
    </View>
  );
};

const MainScreen: FC<{addLog: (msg: string) => void}> = ({addLog}) => {
  const {
    client,
    isConnected,
    isConnecting,
    chat,
    connect,
    disconnect,
    sendResponse,
    updateSession,
    addMessage,
  } = useRealtime();
  const {isUserSpeaking, isAssistantSpeaking} = useSpeechActivity();

  useEffect(() => {
    if (!client) {
      return;
    }
    const unsub = client.on('tool:call_done', ({name, args}) => {
      addLog(`🔧 Tool executed: ${name}`);
      if (name === 'get_weather') {
        addMessage({type: 'ui', kind: 'weather_card', payload: args});
      }
    });
    return unsub;
  }, [client, addMessage, addLog]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Realtime Demo</Text>
        <TouchableOpacity
          style={[styles.connectButton, isConnected && styles.connectedButton]}
          onPress={() => (isConnected ? disconnect() : connect())}
          disabled={isConnecting}>
          <Text style={styles.connectButtonText}>
            {isConnecting ? '...' : isConnected ? 'Online' : 'Offline'}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.activityIndicators}>
        <Text
          style={[
            styles.indicatorText,
            isUserSpeaking && styles.activeIndicator,
          ]}>
          User Speaking
        </Text>
        <Text
          style={[
            styles.indicatorText,
            isAssistantSpeaking && styles.activeIndicator,
          ]}>
          Assistant Speaking
        </Text>
      </View>
      <MicrophoneVisualizer />
      <FlatList
        style={styles.chatList}
        data={chat}
        renderItem={ChatMessage}
        keyExtractor={item => item.id}
        inverted
      />
      {isConnected && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.controls}>
          <Button
            title="Погода"
            onPress={() => sendResponse({instructions: 'Погода в Париже'})}
          />
          <Button
            title="Голос"
            onPress={() => updateSession({voice: 'onyx'})}
          />
          <Button
            title="Mute"
            onPress={() =>
              client
                ?.getLocalStream()
                ?.getAudioTracks()
                .forEach(t => (t.enabled = false))
            }
          />
          <Button
            title="Unmute"
            onPress={() =>
              client
                ?.getLocalStream()
                ?.getAudioTracks()
                .forEach(t => (t.enabled = true))
            }
          />
        </ScrollView>
      )}
    </View>
  );
};

// ====================================================================================
// 5. КОРНЕВОЙ КОМПОНЕНТ С ПОЛНОЙ КОНФИГУРАЦИЕЙ
// ====================================================================================

const TheUltimateExample: FC = () => {
  const [_, setLogs] = useState<string[]>([]);
  const addLog = useCallback((msg: string) => {
    setLogs(prev => [
      `[${new Date().toLocaleTimeString()}] ${msg}`,
      ...prev.slice(0, 100),
    ]);
  }, []);

  const memoizedIncomingMiddleware = useMemo(
    () => createIncomingMiddleware(addLog),
    [addLog],
  );
  const memoizedOutgoingMiddleware = useMemo(
    () => createOutgoingMiddleware(addLog),
    [addLog],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <RealTimeClient
        // ----- 1. БАЗОВЫЕ НАСТРОЙКИ -----
        tokenProvider={tokenProvider}
        autoConnect={false}
        attachChat={true}
        // ----- 2. КОНФИГУРАЦИЯ WEBRTC -----
        webrtc={{
          iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
          offerOptions: {offerToReceiveAudio: true},
        }}
        // ----- 3. КОНФИГУРАЦИЯ СЕССИИ OPENAI -----
        session={{
          model: 'gpt-4o-realtime-preview-2024-12-17',
          voice: 'alloy',
          language: 'ru',
          tools: [
            // ✅ ПРАВИЛЬНАЯ "ПЛОСКАЯ" СХЕМА TOOLS
            {
              type: 'function',
              name: 'get_weather',
              description: 'Получает текущую погоду для указанного города.',
              parameters: {
                type: 'object',
                properties: {
                  city: {type: 'string'},
                  temperature: {type: 'string'},
                  condition: {type: 'string'},
                },
                required: ['city', 'temperature', 'condition'],
              },
            },
          ],
        }}
        autoSessionUpdate={true}
        // ----- 4. ПОВЕДЕНИЕ ЧАТА -----
        chatEnabled={true}
        chatUserAddOnDelta={true}
        chatAssistantAddOnDelta={true}
        policyIsMeaningfulText={text => text.trim().length > 1}
        chatIsMeaningfulText={text => text.trim().length > 0}
        // ----- 5. ХУКИ ЖИЗНЕННОГО ЦИКЛА -----
        onOpen={dc => addLog(`✅ [onOpen] DataChannel "${dc.label}" открыт.`)}
        onEvent={evt => addLog(`[onEvent] Событие после MW: ${evt.type}`)}
        onError={e => {
          addLog(`❌ [onError] ${e.stage}: ${e.error.message}`);
          Alert.alert('Ошибка', e.error.message);
        }}
        onToolCall={async ({name, args}) => {
          addLog(`🔧 [onToolCall] Вызов инструмента: ${name}`);
          if (name === 'get_weather') {
            await new Promise(r => setTimeout(r, 500)); // Симуляция API
            return {
              city: args.city,
              temperature: '25°C',
              condition: 'Солнечно',
            };
          }
        }}
        // ----- 6. MIDDLEWARE -----
        incomingMiddleware={memoizedIncomingMiddleware}
        outgoingMiddleware={memoizedOutgoingMiddleware}>
        <MainScreen addLog={addLog} />
      </RealTimeClient>
    </SafeAreaView>
  );
};

export default TheUltimateExample;

// ====================================================================================
// 6. СТИЛИ И ФИНАЛЬНАЯ ШПАРГАЛКА
// ====================================================================================
const styles = StyleSheet.create({
  safeArea: {flex: 1, backgroundColor: '#000'},
  container: {flex: 1, backgroundColor: '#f0f2f5'},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#e0e0e0',
  },
  title: {fontSize: 20, fontWeight: 'bold'},
  connectButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#dc3545',
  },
  connectedButton: {backgroundColor: '#28a745'},
  connectButtonText: {color: '#fff', fontWeight: '600'},
  activityIndicators: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 10,
    backgroundColor: '#fff',
  },
  indicatorText: {fontSize: 14},
  activeIndicator: {color: '#28a745', fontWeight: 'bold'},
  micVisualizer: {
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    margin: 10,
  },
  micTitle: {textAlign: 'center', marginBottom: 8, fontWeight: '600'},
  micBars: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-end',
    height: 40,
  },
  micBar: {width: 4, marginHorizontal: 1, borderRadius: 2},
  chatList: {flex: 1},
  bubble: {
    padding: 12,
    borderRadius: 18,
    marginBottom: 8,
    maxWidth: '80%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  userBubble: {alignSelf: 'flex-end', backgroundColor: '#007AFF'},
  assistantBubble: {alignSelf: 'flex-start', backgroundColor: '#E5E5EA'},
  userText: {color: '#FFF'},
  assistantText: {color: '#000'},
  weatherCard: {
    alignSelf: 'center',
    backgroundColor: '#d1ecf1',
    borderWidth: 1,
    borderColor: '#bee5eb',
    padding: 15,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  weatherIcon: {fontSize: 32, marginRight: 12},
  weatherCity: {fontSize: 18, fontWeight: 'bold'},
  weatherTemp: {fontSize: 24},
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
  },
});

/*
// ====================================================================================
// 7. ЖИЗНЕННЫЙ ЦИКЛ ОБРАБОТКИ СОБЫТИЙ (ШПАРГАЛКА)
// ====================================================================================

// --- ВХОДЯЩЕЕ СОБЫТИЕ (от OpenAI к вам) ---
// 1. Сообщение по DataChannel
//     |
//     v
// 2. `incomingMiddleware` (Ваш код): Первый на перехват. МОЖЕТ изменить/заблокировать.
//     |
//     v
// 3. `onEvent` хук (Ваш код): Только чтение. Для глобального логирования/аналитики.
//     |
//     v
// 4. Внутренний роутер библиотеки: Парсит тип, вызывает `onToolCall` и другие `on...` хуки.
//     |
//     v
// 5. Встроенный `ChatStore`: Обновляет `chat` на основе событий от роутера.
//     |
//     v
// 6. Подписчики `client.on(...)`: Реакция UI на финальные, обработанные события.

// --- ТРИ УРОВНЯ ОБРАБОТКИ ---
// 1. Middleware: Максимальный контроль. Для трансформации, блокировки, сложной логики.
// 2. Hooks (`on...`): Средний уровень. Для "потребления" событий и основной бизнес-логики (`onToolCall`).
// 3. `client.on(...)`: Низкий уровень. Для реакции UI на финальные события.
*/

/**
 * AdvancedDemo - Продвинутый пример использования react-native-openai-realtime
 *
 * Демонстрирует:
 * - Все хуки: useRealtime, useSpeechActivity, useMicrophoneActivity, useSessionOptions
 * - Incoming и Outgoing middleware
 * - Success callbacks (onSuccess, onPeerConnectionCreated, etc.)
 * - Управление сессией (voice/голос, модальности, VAD)
 * - PTT (Push-to-Talk) режим
 * - Tools (function calling) с автоматическим и ручным режимом
 * - UI-сообщения через addMessage
 * - Императивный API через ref
 * - InCallManager для эхоподавления
 */

import React, {useRef, useState, useEffect, useCallback, useMemo} from 'react';
import {
  View,
  Text,
  Button,
  TextInput,
  FlatList,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Platform,
} from 'react-native';
import {
  RealTimeClient,
  useRealtime,
  useSpeechActivity,
  useMicrophoneActivity,
  useSessionOptions,
  createSpeechActivityMiddleware,
  VOICE_IDS,
  type RealTimeClientHandle,
  type VoiceId,
  type IncomingMiddleware,
  type OutgoingMiddleware,
  type ExtendedChatMsg,
  type RealtimeClientClass,
} from 'react-native-openai-realtime';
import InCallManager from 'react-native-incall-manager';

// ==================== Provider ====================

const SERVER_BASE = 'http://localhost:8787';

const tokenProvider = async () => {
  const response = await fetch(`${SERVER_BASE}/realtime/session`);
  if (!response.ok) {
    throw new Error(`Failed to fetch token: ${response.status}`);
  }
  const data = await response.json();
  return data.client_secret.value;
};

// ==================== Middleware ====================

// Incoming middleware: фильтрация пустых дельт, логирование
const incomingMiddleware: IncomingMiddleware[] = [
  createSpeechActivityMiddleware(), // Отслеживание речевой активности

  // Фильтрация "мусорных" междометий в транскрипции пользователя
  async ({event}) => {
    if (event?.type === 'conversation.item.input_audio_transcription.delta') {
      const delta = event?.delta?.trim() || '';
      // Игнорируем короткие междометия
      if (/^(эм+|мм+|ээ+|ага+|угу+|хм+)\.?$/i.test(delta)) {
        console.log('🚫 Filtered filler word:', delta);
        return 'stop'; // Блокируем событие
      }
    }

    // Фильтрация пустых дельт ассистента
    if (
      event?.type === 'response.text.delta' ||
      event?.type === 'response.audio_transcript.delta'
    ) {
      const delta = event?.delta?.trim() || '';
      if (!delta) {
        return 'stop';
      }
    }

    return; // Пропускаем событие дальше
  },

  // Логирование важных событий
  async ({event}) => {
    const important = new Set([
      'conversation.item.created',
      'response.created',
      'response.done',
      'error',
    ]);

    if (important.has(event?.type)) {
      console.log('📨 Event:', event.type, event);
    }

    return; // Не модифицируем
  },
];

// Outgoing middleware: добавление метаданных, валидация
const outgoingMiddleware: OutgoingMiddleware[] = [
  // Добавление префикса к инструкциям
  event => {
    if (event?.type === 'response.create') {
      const instructions = event.response?.instructions || '';
      return {
        ...event,
        response: {
          ...event.response,
          instructions: `[AdvancedDemo] ${instructions}`,
        },
      };
    }
    return event;
  },

  // Валидация и очистка текстовых сообщений
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
      // Очищаем текст
      event.item.content[0].text = text;
    }
    return event;
  },
];

// ==================== Tools Spec ====================

const toolsSpec = [
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
  {
    type: 'function' as const,
    name: 'set_reminder',
    description: 'Set a reminder',
    parameters: {
      type: 'object',
      properties: {
        text: {type: 'string', description: 'Reminder text'},
        minutes: {type: 'number', description: 'Minutes from now'},
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    name: 'search_flights',
    description: 'Search for flights',
    parameters: {
      type: 'object',
      properties: {
        from: {type: 'string'},
        to: {type: 'string'},
        date: {type: 'string'},
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
];

// ==================== Main Component ====================

export default function AdvancedDemo() {
  const rtcRef = useRef<RealTimeClientHandle>(null);
  const [mode, setMode] = useState<'text' | 'voice'>('text');

  // Success callbacks - детальное логирование
  const onSuccess = useCallback((stage: string, data?: any) => {
    console.log(`✅ [SUCCESS] ${stage}`, data);
  }, []);

  const onPeerConnectionCreated = useCallback((pc: RTCPeerConnection) => {
    console.log('✅ PeerConnection created:', pc.connectionState);
  }, []);

  const onDataChannelOpen = useCallback((dc: RTCDataChannel) => {
    console.log('✅ DataChannel opened:', dc.label, dc.readyState);
  }, []);

  const onLocalStreamSetted = useCallback((stream: MediaStream) => {
    console.log(
      '✅ Local stream set:',
      stream.id,
      stream.getTracks().length,
      'tracks',
    );
  }, []);

  const onRemoteStreamSetted = useCallback((stream: MediaStream) => {
    console.log(
      '✅ Remote stream set:',
      stream.id,
      stream.getTracks().length,
      'tracks',
    );
  }, []);

  const onIceGatheringComplete = useCallback(() => {
    console.log('✅ ICE gathering complete');
  }, []);

  const onMicrophonePermissionDenied = useCallback(() => {
    console.warn('⚠️ Microphone permission denied - fallback to recvonly');
  }, []);

  // Error handler
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

  // Event logger
  const onEvent = useCallback((event: any) => {
    // Логируем только важные события (чтобы не засорять консоль)
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

  // Tool call handler
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
      console.log('🔧 Tool call:', name, args);

      try {
        let result: any;

        // Имитация вызовов tools
        if (name === 'get_weather') {
          result = {
            city: args.city,
            temperature: Math.round(15 + Math.random() * 15),
            condition: 'Sunny',
            humidity: Math.round(40 + Math.random() * 30),
          };

          // Добавляем UI-карточку с погодой через ref
          rtcRef.current?.addMessage({
            type: 'ui',
            role: 'assistant',
            kind: 'weather_card',
            payload: result,
          });
        } else if (name === 'set_reminder') {
          result = {
            ok: true,
            text: args.text,
            scheduled_in: args.minutes || 10,
          };

          rtcRef.current?.addMessage({
            type: 'ui',
            role: 'assistant',
            kind: 'reminder_set',
            payload: result,
          });
        } else if (name === 'search_flights') {
          // Имитация API вызова
          const mockFlights = [
            {id: 1, airline: 'Air Example', price: 299, departure: '10:00'},
            {id: 2, airline: 'Sky Travel', price: 349, departure: '14:30'},
          ];

          result = {
            from: args.from,
            to: args.to,
            date: args.date,
            flights: mockFlights,
          };

          rtcRef.current?.addMessage({
            type: 'ui',
            role: 'assistant',
            kind: 'flights',
            payload: result,
          });
        }

        // Возвращаем результат - библиотека автоматически отправит function_call_output
        // и сделает response.create
        return result;
      } catch (error: any) {
        console.error('❌ Tool call failed:', error);

        rtcRef.current?.addMessage({
          type: 'ui',
          role: 'assistant',
          kind: 'error',
          payload: {error: error.message || String(error)},
        });

        return {error: error.message || String(error)};
      }
    },
    [],
  );

  // Logger
  const logger = useMemo(
    () => ({
      info: (...args: any[]) => console.log('ℹ️', ...args),
      warn: (...args: any[]) => console.warn('⚠️', ...args),
      error: (...args: any[]) => console.error('❌', ...args),
      debug: (...args: any[]) => {
        if (__DEV__) console.log('🐛', ...args);
      },
    }),
    [],
  );

  return (
    <RealTimeClient
      ref={rtcRef}
      tokenProvider={tokenProvider}
      // WebRTC конфигурация
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
        configuration: {
          iceCandidatePoolSize: 10,
        },
      }}
      // Media constraints
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
      // Session config
      session={{
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'alloy',
        modalities: ['text'], // Стартуем в текстовом режиме
        input_audio_transcription: {
          model: 'whisper-1',
        },
        turn_detection: null, // В текстовом режиме VAD не нужен
        tools: toolsSpec,
        instructions:
          'Ты умный ассистент. Отвечай кратко. Используй инструменты когда нужно.',
      }}
      // Greet
      greetEnabled={false} // Отключаем автоприветствие для демо
      // Hooks
      onSuccess={onSuccess}
      onError={onError}
      onEvent={onEvent}
      onToolCall={onToolCall}
      onPeerConnectionCreated={onPeerConnectionCreated}
      onDataChannelOpen={onDataChannelOpen}
      onLocalStreamSetted={onLocalStreamSetted}
      onRemoteStreamSetted={onRemoteStreamSetted}
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
      chatInverted={false}
      chatUserAddOnDelta={true}
      chatAssistantAddOnDelta={true}
      deleteChatHistoryOnDisconnect={false}
      // Other
      logger={logger}
      autoConnect={false}
      autoSessionUpdate={false} // Управляем сессией вручную через useSessionOptions
      attachChat={true}
      allowConnectWithoutMic={true}>
      {ctx => <AdvancedDemoScreen mode={mode} setMode={setMode} />}
    </RealTimeClient>
  );
}

// ==================== Screen Component ====================

type Props = {
  mode: 'text' | 'voice';
  setMode: (mode: 'text' | 'voice') => void;
};

function AdvancedDemoScreen({mode, setMode}: Props) {
  const {
    client,
    status,
    chat,
    connect,
    disconnect,
    sendRaw,
    sendResponse,
    sendResponseStrict,
    updateSession,
    addMessage,
    clearAdded,
    clearChatHistory,
  } = useRealtime();

  // Speech activity
  const {isUserSpeaking, isAssistantSpeaking, inputBuffered, outputBuffered} =
    useSpeechActivity();

  // Microphone activity
  const mic = useMicrophoneActivity({
    client: client as RealtimeClientClass,
    mode: 'auto',
    pollInterval: 100,
    silenceMs: 600,
    levelThreshold: 0.02,
  });

  // Session options hook
  const {
    initializeMode,
    closeVoiceMode,
    cancelAssistant,
    handleSendMessage,
    enforceTextSession,
    enforceVoiceSession,
    setRemoteTracksEnabled,
  } = useSessionOptions({
    client,
    switchMode: async newMode => {
      setMode(newMode);
      console.log(`🔄 Switched to ${newMode} mode`);
    },
    onSuccess: stage => console.log('✅', stage),
    onError: (stage, error) => console.error('❌', stage, error),
  });

  // ==================== State ====================

  const [inputText, setInputText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<VoiceId>('alloy');
  const [vadThreshold, setVadThreshold] = useState(0.5);
  const [silenceMs, setSilenceMs] = useState(700);
  const [pttMode, setPttMode] = useState(false);
  const [manualToolMode, setManualToolMode] = useState(false);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  // ==================== Effects ====================

  // InCallManager setup для voice mode
  useEffect(() => {
    if (mode === 'voice' && isConnected) {
      try {
        InCallManager.start({media: 'audio'});
        InCallManager.setForceSpeakerphoneOn(true);
        console.log('✅ InCallManager started');
      } catch (error) {
        console.warn('⚠️ InCallManager failed:', error);
      }

      return () => {
        try {
          InCallManager.stop();
          console.log('✅ InCallManager stopped');
        } catch {}
      };
    }
  }, [mode, isConnected]);

  // Подписка на события клиента для демонстрации
  useEffect(() => {
    if (!client) return;

    const unsubs = [
      client.on('user:item_started', ({itemId}: any) =>
        console.log('👤 User started:', itemId),
      ),
      client.on('user:completed', ({itemId, transcript}: any) =>
        console.log('👤 User completed:', itemId, transcript),
      ),
      client.on('assistant:response_started', ({responseId}: any) =>
        console.log('🤖 Assistant started:', responseId),
      ),
      client.on('assistant:completed', ({responseId, status: s}: any) =>
        console.log('🤖 Assistant completed:', responseId, s),
      ),
      client.on('tool:call_done', ({call_id, name, args}: any) => {
        console.log('🔧 Tool done:', name, args);

        // Ручной режим tools (если включен)
        if (manualToolMode) {
          const output = {manual_mode: true, args};
          client.sendToolOutput(call_id, output);
          client.sendResponse({
            instructions: `Tool ${name} completed with args: ${JSON.stringify(args)}`,
            modalities: ['text'],
          });
        }
      }),
      client.on('error', ({scope, error}: any) =>
        console.error('🚨 Server error:', scope, error),
      ),
    ];

    return () => {
      unsubs.forEach(unsub => {
        try {
          unsub();
        } catch {}
      });
    };
  }, [client, manualToolMode]);

  // ==================== Handlers ====================

  const handleConnect = async () => {
    try {
      await connect();

      // После подключения инициализируем текстовый режим
      await initializeMode('text');
    } catch (error) {
      console.error('Failed to connect:', error);
    }
  };

  const handleDisconnect = async () => {
    try {
      if (mode === 'voice') {
        await closeVoiceMode();
      }
      await disconnect();
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  const handleSwitchToVoice = async () => {
    try {
      await initializeMode('voice');
    } catch (error) {
      console.error('Failed to switch to voice:', error);
    }
  };

  const handleSwitchToText = async () => {
    try {
      await closeVoiceMode();
    } catch (error) {
      console.error('Failed to switch to text:', error);
    }
  };

  const handleUpdateVoice = (voice: VoiceId) => {
    setSelectedVoice(voice);
    updateSession({voice});
  };

  const handleApplyVAD = () => {
    updateSession({
      turn_detection: {
        type: 'server_vad',
        threshold: vadThreshold,
        silence_duration_ms: silenceMs,
        prefix_padding_ms: 300,
      },
    });
  };

  const handleEnablePTT = () => {
    setPttMode(true);
    updateSession({turn_detection: null}); // Отключаем VAD
  };

  const handleDisablePTT = () => {
    setPttMode(false);
    handleApplyVAD(); // Восстанавливаем VAD
  };

  const handlePTTDown = () => {
    try {
      const local = client?.getLocalStream();
      local?.getAudioTracks().forEach(track => {
        track.enabled = true;
      });
    } catch (error) {
      console.error('Failed to enable mic:', error);
    }
  };

  const handlePTTUp = async () => {
    try {
      await sendRaw({type: 'input_audio_buffer.commit'});
      await sendRaw({type: 'response.create'});
      await sendRaw({type: 'input_audio_buffer.clear'});
    } catch (error) {
      console.error('PTT error:', error);
    }
  };

  const handleSendText = async () => {
    const text = inputText.trim();
    if (!text) return;

    setInputText('');

    await handleSendMessage(
      text,
      () => console.log('✅ Message sent'),
      error => console.error('❌ Failed to send:', error),
    );
  };

  const handleQuickResponse = async () => {
    await sendResponseStrict({
      instructions: 'Расскажи интересный факт о космосе.',
      modalities: mode === 'voice' ? ['audio', 'text'] : ['text'],
      conversation: 'auto',
    });
  };

  const handleAddUIMessage = () => {
    addMessage({
      type: 'ui',
      role: 'system',
      kind: 'hint',
      payload: {text: '💡 Подсказка: попробуй спросить про погоду!'},
    });
  };

  // ==================== Render ====================

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Advanced OpenAI Realtime Demo</Text>
        <Text style={styles.subtitle}>
          Status: {status} | Mode: {mode}
        </Text>
      </View>

      {/* Connection */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔌 Connection</Text>
        <View style={styles.row}>
          <Button
            title={isConnecting ? 'Connecting...' : 'Connect'}
            onPress={handleConnect}
            disabled={isConnected || isConnecting}
          />
          <Button
            title="Disconnect"
            onPress={handleDisconnect}
            disabled={!isConnected}
          />
          <Button
            title="Cancel Response"
            onPress={cancelAssistant}
            disabled={!isConnected}
          />
        </View>
      </View>

      {/* Mode Switching */}
      {isConnected && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎛️ Mode</Text>
          <View style={styles.row}>
            <Button
              title="Switch to Voice"
              onPress={handleSwitchToVoice}
              disabled={mode === 'voice'}
            />
            <Button
              title="Switch to Text"
              onPress={handleSwitchToText}
              disabled={mode === 'text'}
            />
          </View>
        </View>
      )}

      {/* Speech & Microphone Activity */}
      {isConnected && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎤 Speech & Microphone</Text>
          <View style={styles.infoGrid}>
            <Text>User Speaking: {isUserSpeaking ? '🟢' : '⚪'}</Text>
            <Text>Assistant Speaking: {isAssistantSpeaking ? '🟢' : '⚪'}</Text>
            <Text>Input Buffered: {inputBuffered ? '🟢' : '⚪'}</Text>
            <Text>Output Buffered: {outputBuffered ? '🟢' : '⚪'}</Text>
            <Text>Mic Active: {mic.isMicActive ? '🟢' : '⚪'}</Text>
            <Text>Capturing: {mic.isCapturing ? '🟢' : '⚪'}</Text>
          </View>
          <View style={styles.levelBar}>
            <View style={[styles.levelFill, {width: `${mic.level * 100}%`}]} />
          </View>
          <Text style={styles.levelText}>
            Microphone Level: {Math.round(mic.level * 100)}%
          </Text>
        </View>
      )}

      {/* Voice Settings */}
      {isConnected && mode === 'voice' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🎙️ Voice Settings</Text>

          <Text style={styles.label}>Voice:</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.row}>
              {VOICE_IDS.map(voice => (
                <TouchableOpacity
                  key={voice}
                  style={[
                    styles.voicePill,
                    selectedVoice === voice && styles.voicePillActive,
                  ]}
                  onPress={() => handleUpdateVoice(voice as VoiceId)}>
                  <Text
                    style={[
                      styles.voicePillText,
                      selectedVoice === voice && styles.voicePillTextActive,
                    ]}>
                    {voice}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          <View style={styles.vadControls}>
            <View style={styles.vadRow}>
              <Text style={styles.label}>
                VAD Threshold: {vadThreshold.toFixed(2)}
              </Text>
              <View style={styles.row}>
                <Button
                  title="-"
                  onPress={() => setVadThreshold(v => Math.max(0, v - 0.05))}
                />
                <Button
                  title="+"
                  onPress={() => setVadThreshold(v => Math.min(1, v + 0.05))}
                />
              </View>
            </View>

            <View style={styles.vadRow}>
              <Text style={styles.label}>Silence: {silenceMs}ms</Text>
              <View style={styles.row}>
                <Button
                  title="-100"
                  onPress={() => setSilenceMs(v => Math.max(100, v - 100))}
                />
                <Button
                  title="+100"
                  onPress={() => setSilenceMs(v => Math.min(3000, v + 100))}
                />
              </View>
            </View>

            <Button title="Apply VAD" onPress={handleApplyVAD} />
          </View>
        </View>
      )}

      {/* PTT Mode */}
      {isConnected && mode === 'voice' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📻 Push-to-Talk (PTT)</Text>
          <View style={styles.switchRow}>
            <Text>PTT Mode:</Text>
            <Switch
              value={pttMode}
              onValueChange={v => (v ? handleEnablePTT() : handleDisablePTT())}
            />
          </View>
          {pttMode && (
            <TouchableOpacity
              style={styles.pttButton}
              onPressIn={handlePTTDown}
              onPressOut={handlePTTUp}>
              <Text style={styles.pttButtonText}>HOLD TO TALK</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Tools */}
      {isConnected && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🔧 Tools (Function Calling)</Text>
          <View style={styles.switchRow}>
            <Text>Manual Tool Mode:</Text>
            <Switch value={manualToolMode} onValueChange={setManualToolMode} />
          </View>
          <Text style={styles.helperText}>
            {manualToolMode
              ? 'Tools будут обрабатываться вручную через sendToolOutput'
              : 'Tools обрабатываются автоматически через onToolCall'}
          </Text>
        </View>
      )}

      {/* Quick Actions */}
      {isConnected && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⚡ Quick Actions</Text>
          <View style={styles.row}>
            <Button title="Space Fact" onPress={handleQuickResponse} />
            <Button title="Add UI Hint" onPress={handleAddUIMessage} />
            <Button title="Clear Added" onPress={clearAdded} />
            <Button title="Clear Chat" onPress={clearChatHistory} />
          </View>
        </View>
      )}

      {/* Chat */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          💬 Chat ({chat.length} messages)
        </Text>
        <View style={styles.chatContainer}>
          <FlatList
            data={chat}
            keyExtractor={item => item.id}
            inverted
            renderItem={({item}) => (
              <ChatMessage message={item as ExtendedChatMsg} />
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>
                  {!isConnected ? 'Not connected' : 'No messages'}
                </Text>
              </View>
            }
          />
        </View>
      </View>

      {/* Text Input */}
      {isConnected && mode === 'text' && (
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleSendText}
            returnKeyType="send"
            multiline
          />
          <Button
            title="Send"
            onPress={handleSendText}
            disabled={!inputText.trim()}
          />
        </View>
      )}

      <View style={{height: 40}} />
    </ScrollView>
  );
}

// ==================== Chat Message Component ====================

function ChatMessage({message}: {message: ExtendedChatMsg}) {
  if (message.type === 'ui') {
    // UI messages
    return (
      <View style={[styles.message, styles.messageUI]}>
        <Text style={styles.messageRole}>UI: {message.kind}</Text>
        {message.kind === 'weather_card' && (
          <View>
            <Text style={styles.messageText}>
              🌤️ {message.payload.city}: {message.payload.temperature}°C
            </Text>
            <Text style={styles.messageText}>
              {message.payload.condition} • Humidity: {message.payload.humidity}
              %
            </Text>
          </View>
        )}
        {message.kind === 'reminder_set' && (
          <Text style={styles.messageText}>
            ⏰ Reminder set: "{message.payload.text}" in{' '}
            {message.payload.scheduled_in} min
          </Text>
        )}
        {message.kind === 'flights' && (
          <View>
            <Text style={styles.messageText}>
              ✈️ {message.payload.from} → {message.payload.to}
            </Text>
            {message.payload.flights.map((f: any) => (
              <Text key={f.id} style={styles.messageText}>
                • {f.airline} - ${f.price} ({f.departure})
              </Text>
            ))}
          </View>
        )}
        {message.kind === 'hint' && (
          <Text style={styles.messageText}>{message.payload.text}</Text>
        )}
        {message.kind === 'error' && (
          <Text style={[styles.messageText, {color: '#ef4444'}]}>
            ❌ {message.payload.error}
          </Text>
        )}
      </View>
    );
  }

  // Text messages
  const isUser = message.role === 'user';
  const isStreaming = message.status === 'streaming';

  return (
    <View
      style={[
        styles.message,
        isUser ? styles.messageUser : styles.messageAssistant,
      ]}>
      <Text style={styles.messageRole}>
        {message.role}
        {isStreaming && ' (typing...)'}
      </Text>
      <Text style={styles.messageText}>{message.text || '...'}</Text>
      <Text style={styles.messageTime}>
        {new Date(message.time).toLocaleTimeString()}
      </Text>
    </View>
  );
}

// ==================== Styles ====================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    padding: 16,
    backgroundColor: '#1f2937',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
  },
  section: {
    padding: 16,
    backgroundColor: '#fff',
    marginVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    color: '#111827',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  levelBar: {
    height: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 8,
  },
  levelFill: {
    height: 8,
    backgroundColor: '#10b981',
  },
  levelText: {
    fontSize: 12,
    color: '#6b7280',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  voicePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    marginRight: 8,
  },
  voicePillActive: {
    backgroundColor: '#3b82f6',
  },
  voicePillText: {
    fontSize: 14,
    color: '#374151',
  },
  voicePillTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  vadControls: {
    marginTop: 12,
    gap: 12,
  },
  vadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  helperText: {
    fontSize: 12,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  pttButton: {
    backgroundColor: '#3b82f6',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  pttButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  chatContainer: {
    height: 300,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    overflow: 'hidden',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#9ca3af',
  },
  message: {
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 8,
    maxWidth: '80%',
  },
  messageUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#dbeafe',
  },
  messageAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  messageUI: {
    alignSelf: 'center',
    backgroundColor: '#fef3c7',
  },
  messageRole: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 14,
    color: '#111827',
  },
  messageTime: {
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 4,
  },
  inputContainer: {
    padding: 16,
    backgroundColor: '#fff',
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    maxHeight: 120,
  },
});

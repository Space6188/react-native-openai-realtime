/**
 * LowLevelDemo - Пример использования низкоуровневого API (RealtimeClientClass)
 *
 * Демонстрирует:
 * - Прямое использование RealtimeClientClass без React компонента
 * - Ручное управление жизненным циклом
 * - attachChatAdapter для интеграции с React state
 * - Детальные Success/Error handlers
 * - Полный контроль над всеми аспектами соединения
 *
 * Когда использовать низкоуровневый API:
 * - Нужен полный контроль над инициализацией
 * - Интеграция в существующую архитектуру
 * - Множественные клиенты в одном приложении
 * - Продвинутые сценарии с ручным управлением
 */

import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  Button,
  FlatList,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {
  RealtimeClientClass,
  attachChatAdapter,
  ErrorHandler,
  SuccessHandler,
  type ChatMsg,
  type ErrorEvent,
  type SuccessCallbacks,
} from 'react-native-openai-realtime';

// ==================== Configuration ====================

const SERVER_BASE = 'http://localhost:8787';

const tokenProvider = async () => {
  const response = await fetch(`${SERVER_BASE}/realtime/session`);
  if (!response.ok) {
    throw new Error(`Failed to fetch token: ${response.status}`);
  }
  const data = await response.json();
  return data.client_secret.value;
};

// ==================== Main Component ====================

export default function LowLevelDemo() {
  const clientRef = useRef<RealtimeClientClass | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  // Helper to add logs
  const addLog = (message: string) => {
    setLogs(prev =>
      [`[${new Date().toLocaleTimeString()}] ${message}`, ...prev].slice(
        0,
        100,
      ),
    );
  };

  // ==================== Initialization ====================

  useEffect(() => {
    // ==================== Error Handler ====================

    const errorHandler = new ErrorHandler((event: ErrorEvent) => {
      const {stage, error, severity, recoverable, context} = event;

      console.error(`❌ Error at ${stage}:`, error);
      addLog(`ERROR [${severity}] ${stage}: ${error?.message || error}`);

      if (context) {
        console.error('Context:', context);
      }

      // Если критическая ошибка - обновляем статус
      if (severity === 'critical') {
        setStatus('error');
      }
    });

    // ==================== Success Handler ====================

    const successCallbacks: SuccessCallbacks = {
      // Hang up
      onHangUpStarted: () => {
        console.log('🔌 Hang up started');
        addLog('Disconnecting...');
      },
      onHangUpDone: () => {
        console.log('🔌 Hang up done');
        addLog('Disconnected');
      },

      // Peer Connection
      onPeerConnectionCreatingStarted: () => {
        console.log('🔄 Creating PeerConnection...');
        addLog('Creating PeerConnection...');
      },
      onPeerConnectionCreated: pc => {
        console.log('✅ PeerConnection created:', pc.connectionState);
        addLog(`PeerConnection created: ${pc.connectionState}`);
      },
      onRTCPeerConnectionStateChange: state => {
        console.log('🔄 Connection state:', state);
        addLog(`Connection state: ${state}`);
        setStatus(state);
      },

      // Media
      onGetUserMediaSetted: stream => {
        console.log('🎤 getUserMedia OK:', stream?.id);
        addLog(`getUserMedia: ${stream?.getTracks().length} tracks`);
      },
      onLocalStreamSetted: stream => {
        console.log('🎤 Local stream set:', stream?.id);
        addLog(`Local stream: ${stream?.getTracks().length} tracks`);
      },
      onLocalStreamAddedTrack: track => {
        console.log('➕ Local track added:', track.kind);
        addLog(`Track added: ${track.kind}`);
      },
      onLocalStreamRemovedTrack: track => {
        console.log('➖ Local track removed:', track.kind);
        addLog(`Track removed: ${track.kind}`);
      },
      onRemoteStreamSetted: stream => {
        console.log('🔊 Remote stream set:', stream?.id);
        addLog(`Remote stream: ${stream?.getTracks().length} tracks`);
      },

      // DataChannel
      onDataChannelOpen: channel => {
        console.log('✅ DataChannel opened:', channel?.label);
        addLog(`DataChannel opened: ${channel?.label}`);
      },
      onDataChannelMessage: message => {
        // Логируем только тип события (не весь payload)
        const type = message?.type || 'unknown';
        console.log('📨 DC message:', type);
      },
      onDataChannelClose: () => {
        console.log('❌ DataChannel closed');
        addLog('DataChannel closed');
      },

      // ICE
      onIceGatheringComplete: () => {
        console.log('✅ ICE gathering complete');
        addLog('ICE gathering complete');
      },
      onIceGatheringTimeout: () => {
        console.warn('⏱️ ICE gathering timeout');
        addLog('ICE gathering timeout');
      },
      onIceGatheringStateChange: state => {
        console.log('🔄 ICE state:', state);
        addLog(`ICE state: ${state}`);
      },

      // Microphone
      onMicrophonePermissionGranted: () => {
        console.log('✅ Microphone permission granted');
        addLog('Microphone permission granted');
      },
      onMicrophonePermissionDenied: () => {
        console.warn('⚠️ Microphone permission denied');
        addLog('Microphone permission denied - fallback mode');
      },

      // iOS
      onIOSTransceiverSetted: () => {
        console.log('✅ iOS transceiver set');
        addLog('iOS transceiver set');
      },
    };

    // Universal success callback
    const onSuccess = (stage: string, data?: any) => {
      console.log(`✅ [SUCCESS] ${stage}`, data);
      // Можно добавить в лог только важные стадии
    };

    const successHandler = new SuccessHandler(successCallbacks, onSuccess);

    // ==================== Client Creation ====================

    const client = new RealtimeClientClass(
      {
        tokenProvider,
        // WebRTC
        webrtc: {
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
        },
        // Media
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
        // Session
        session: {
          model: 'gpt-4o-realtime-preview-2024-12-17',
          voice: 'alloy',
          modalities: ['text'],
          input_audio_transcription: {
            model: 'whisper-1',
          },
          turn_detection: null,
          instructions: 'Ты дружелюбный ассистент. Отвечай кратко и по делу.',
        },
        autoSessionUpdate: false,
        // Hooks
        hooks: {
          onOpen: dc => {
            console.log('🎉 Connected!', dc?.label);
            addLog('Connected!');

            // Отправляем session.update вручную
            client.updateSession({
              modalities: ['text'],
              turn_detection: null,
            });
          },
          onEvent: evt => {
            const type = evt?.type || 'unknown';
            console.log('📨 Event:', type);
          },
        },
        // Middleware
        middleware: {
          incoming: [
            async ({event}) => {
              // Фильтрация пустых дельт
              if (
                event?.type === 'response.text.delta' ||
                event?.type === 'response.audio_transcript.delta'
              ) {
                if (!event?.delta?.trim()) {
                  return 'stop';
                }
              }
              return;
            },
          ],
          outgoing: [
            event => {
              // Валидация текстовых сообщений
              if (
                event?.type === 'conversation.item.create' &&
                event.item?.content?.[0]?.type === 'input_text'
              ) {
                const text = (event.item.content[0].text || '').trim();
                if (!text) {
                  console.warn('⚠️ Blocked empty message');
                  return 'stop';
                }
                event.item.content[0].text = text;
              }
              return event;
            },
          ],
        },
        // Policy
        policy: {
          isMeaningfulText: text => text.trim().length >= 2,
        },
        // Chat
        chat: {
          enabled: true,
          isMeaningfulText: text => !!text.trim(),
          userAddOnDelta: true,
          assistantAddOnDelta: true,
        },
        // Other
        deleteChatHistoryOnDisconnect: false,
        allowConnectWithoutMic: true,
        logger: {
          info: (...args) => console.log('ℹ️', ...args),
          warn: (...args) => console.warn('⚠️', ...args),
          error: (...args) => console.error('❌', ...args),
          debug: (...args) => {
            if (__DEV__) console.log('🐛', ...args);
          },
        },
      },
      successHandler,
      errorHandler,
    );

    clientRef.current = client;

    // ==================== Attach Chat Adapter ====================

    // Связываем встроенный ChatStore с React state
    const detachChat = attachChatAdapter(client, setChat);

    // ==================== Status Subscription ====================

    const unsubStatus = client.onConnectionStateChange(state => {
      setStatus(state);
      addLog(`Status changed: ${state}`);
    });

    // ==================== Event Subscriptions ====================

    const unsubUser = client.on('user:delta', ({itemId, delta}) => {
      console.log('👤 User delta:', itemId, delta);
    });

    const unsubAssistant = client.on(
      'assistant:delta',
      ({responseId, delta, channel}) => {
        console.log('🤖 Assistant delta:', channel, responseId, delta);
      },
    );

    const unsubError = client.on('error', ({scope, error}) => {
      console.error('🚨 Server error:', scope, error);
      addLog(`Server error: ${scope}`);
    });

    // ==================== Cleanup ====================

    return () => {
      try {
        detachChat();
        unsubStatus();
        unsubUser();
        unsubAssistant();
        unsubError();
      } catch (e) {
        console.error('Cleanup error:', e);
      }

      // Disconnect
      client.disconnect().catch(e => console.error('Disconnect error:', e));
    };
  }, []);

  // ==================== Handlers ====================

  const handleConnect = async () => {
    try {
      addLog('Connecting...');
      await clientRef.current?.connect();
    } catch (error) {
      console.error('Connect error:', error);
      addLog(`Connect error: ${error}`);
    }
  };

  const handleDisconnect = async () => {
    try {
      addLog('Disconnecting...');
      await clientRef.current?.disconnect();
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  };

  const handleSendMessage = async () => {
    const client = clientRef.current;
    if (!client) return;

    try {
      addLog('Sending message...');

      await client.sendRaw({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{type: 'input_text', text: 'Tell me a short joke'}],
        },
      });

      await client.sendResponseStrict({
        instructions: 'Ответь кратко.',
        modalities: ['text'],
        conversation: 'auto',
      });

      addLog('Message sent');
    } catch (error) {
      console.error('Send error:', error);
      addLog(`Send error: ${error}`);
    }
  };

  const handleClearChat = () => {
    clientRef.current?.clearChatHistory();
    addLog('Chat cleared');
  };

  const handleGetInfo = () => {
    const client = clientRef.current;
    if (!client) return;

    const pc = client.getPeerConnection();
    const dc = client.getDataChannel();
    const local = client.getLocalStream();
    const remote = client.getRemoteStream();

    addLog('=== Client Info ===');
    addLog(`PC state: ${pc?.connectionState || 'n/a'}`);
    addLog(`ICE state: ${pc?.iceConnectionState || 'n/a'}`);
    addLog(`DC state: ${dc?.readyState || 'n/a'}`);
    addLog(`Local tracks: ${local?.getTracks().length || 0}`);
    addLog(`Remote tracks: ${remote?.getTracks().length || 0}`);
    addLog(`Chat messages: ${client.getChat().length}`);
  };

  // ==================== Render ====================

  const isConnected = status === 'connected';

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Low-Level API Demo</Text>
        <Text style={styles.subtitle}>Using RealtimeClientClass directly</Text>
        <Text style={styles.status}>Status: {status}</Text>
      </View>

      {/* Controls */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Controls</Text>
        <View style={styles.buttonRow}>
          <Button
            title="Connect"
            onPress={handleConnect}
            disabled={isConnected}
          />
          <Button
            title="Disconnect"
            onPress={handleDisconnect}
            disabled={!isConnected}
          />
        </View>
        <View style={styles.buttonRow}>
          <Button
            title="Send Message"
            onPress={handleSendMessage}
            disabled={!isConnected}
          />
          <Button title="Clear Chat" onPress={handleClearChat} />
        </View>
        <View style={styles.buttonRow}>
          <Button title="Get Info" onPress={handleGetInfo} />
        </View>
      </View>

      {/* Chat */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Chat ({chat.length} messages)</Text>
        <View style={styles.chatContainer}>
          <FlatList
            data={chat}
            keyExtractor={item => item.id}
            inverted
            renderItem={({item}) => (
              <View
                style={[
                  styles.message,
                  item.role === 'user'
                    ? styles.messageUser
                    : styles.messageAssistant,
                ]}>
                <Text style={styles.messageRole}>{item.role}</Text>
                <Text style={styles.messageText}>{item.text || '...'}</Text>
                <Text style={styles.messageStatus}>
                  {item.status} • {new Date(item.time).toLocaleTimeString()}
                </Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No messages</Text>
              </View>
            }
          />
        </View>
      </View>

      {/* Logs */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Logs ({logs.length})</Text>
        <View style={styles.logsContainer}>
          <FlatList
            data={logs.slice(0, 50)}
            keyExtractor={(_, i) => String(i)}
            renderItem={({item}) => <Text style={styles.logItem}>{item}</Text>}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No logs yet</Text>
              </View>
            }
          />
        </View>
      </View>

      <View style={{height: 40}} />
    </ScrollView>
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
    backgroundColor: '#111827',
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
    marginBottom: 8,
  },
  status: {
    fontSize: 14,
    color: '#10b981',
    fontWeight: '600',
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
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
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
  messageStatus: {
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 4,
  },
  logsContainer: {
    height: 300,
    backgroundColor: '#1f2937',
    borderRadius: 8,
    padding: 12,
  },
  logItem: {
    fontSize: 12,
    color: '#d1d5db',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
});

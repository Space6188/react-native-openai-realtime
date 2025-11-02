/**
 * AdvancedChat - Обновленный пример использования низкоуровневого API
 *
 * УСТАРЕЛ: Используйте LowLevelDemo.tsx для более полного примера
 *
 * Демонстрирует:
 * - Прямое использование RealtimeClientClass
 * - Success/Error handlers
 * - attachChatAdapter для React интеграции
 * - Подписки на события
 */

import React, {useEffect, useRef, useState} from 'react';
import {View, Text, Button, StyleSheet, FlatList} from 'react-native';
import {
  RealtimeClientClass,
  attachChatAdapter,
  ErrorHandler,
  SuccessHandler,
  type ChatMsg,
} from 'react-native-openai-realtime';

const SERVER_BASE = 'http://localhost:8787';

export function AdvancedChat() {
  const clientRef = useRef<RealtimeClientClass | null>(null);
  const [status, setStatus] = useState('idle');
  const [chat, setChat] = useState<ChatMsg[]>([]);

  useEffect(() => {
    // Error handler
    const errorHandler = new ErrorHandler(event => {
      console.error('Error:', event.stage, event.error);
      console.error(
        'Severity:',
        event.severity,
        'Recoverable:',
        event.recoverable,
      );
    });

    // Success handler с детальными callbacks
    const successHandler = new SuccessHandler(
      {
        onPeerConnectionCreatingStarted: () => console.log('✅ PC creating…'),
        onPeerConnectionCreated: pc =>
          console.log('✅ PC created:', pc.connectionState),
        onRTCPeerConnectionStateChange: state => {
          console.log('🔄 PC state:', state);
          setStatus(state);
        },
        onGetUserMediaSetted: s => console.log('✅ getUserMedia OK:', s?.id),
        onLocalStreamSetted: s => console.log('✅ Local stream:', s?.id),
        onLocalStreamAddedTrack: t => console.log('➕ Track added:', t.kind),
        onLocalStreamRemovedTrack: t =>
          console.log('➖ Track removed:', t.kind),
        onRemoteStreamSetted: s => console.log('✅ Remote stream:', s?.id),
        onDataChannelOpen: dc => console.log('✅ DC opened:', dc?.label),
        onDataChannelMessage: m => {
          // Логируем только тип (не весь payload)
          const type = m?.type || 'unknown';
          if (type !== 'response.audio_transcript.delta') {
            console.log('📨 DC message:', type);
          }
        },
        onDataChannelClose: () => console.log('❌ DC closed'),
        onIceGatheringComplete: () => console.log('✅ ICE complete'),
        onIceGatheringTimeout: () => console.warn('⏱️ ICE timeout'),
        onIceGatheringStateChange: st => console.log('🔄 ICE state:', st),
        onMicrophonePermissionGranted: () => console.log('✅ Mic granted'),
        onMicrophonePermissionDenied: () => console.warn('⚠️ Mic denied'),
        onHangUpStarted: () => console.log('🔌 Hangup started'),
        onHangUpDone: () => console.log('🔌 Hangup done'),
        onIOSTransceiverSetted: () => console.log('✅ iOS transceiver set'),
      },
      // Universal success callback
      (stage, data) => {
        const important = [
          'peer_connection_created',
          'data_channel_open',
          'ice_gathering_complete',
        ];
        if (important.includes(stage)) {
          console.log(`✅ [SUCCESS] ${stage}`, data);
        }
      },
    );

    // Токен-провайдер
    const tokenProvider = async () => {
      const r = await fetch(`${SERVER_BASE}/realtime/session`);
      if (!r.ok) {
        throw new Error(`Failed to fetch token: ${r.status}`);
      }
      const j = await r.json();
      return j.client_secret.value;
    };

    // Создание клиента
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
          instructions: 'Ты дружелюбный ассистент. Отвечай кратко.',
        },
        autoSessionUpdate: false,
        // Hooks
        hooks: {
          onOpen: dc => {
            console.log('🎉 Connected!', dc?.label);
            // Отправляем session.update вручную
            client.updateSession({
              modalities: ['text'],
              turn_detection: null,
            });
          },
          onEvent: evt => {
            const important = [
              'conversation.item.created',
              'response.created',
              'error',
            ];
            if (important.includes(evt?.type)) {
              console.log('📨 Event:', evt.type);
            }
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
          isMeaningfulText: t => t.trim().length > 0,
        },
        // Chat
        chat: {
          enabled: true,
          isMeaningfulText: t => !!t.trim(),
          userAddOnDelta: true,
          assistantAddOnDelta: true,
        },
        // Other
        deleteChatHistoryOnDisconnect: false,
        allowConnectWithoutMic: true,
      },
      successHandler,
      errorHandler,
    );

    clientRef.current = client;

    // Attach chat adapter
    const detach = attachChatAdapter(client, setChat);

    // Status subscription
    const unsubStatus = client.onConnectionStateChange(setStatus);

    // Event subscriptions
    const unsubUser = client.on('user:delta', ({itemId, delta}) => {
      console.log('👤 User delta:', itemId, delta);
    });

    const unsubAssistant = client.on(
      'assistant:delta',
      ({responseId, delta, channel}) => {
        console.log('🤖 Assistant delta:', channel, responseId, delta);
      },
    );

    return () => {
      try {
        detach();
        unsubStatus();
        unsubUser();
        unsubAssistant();
      } catch {}
      client.disconnect().catch(() => {});
    };
  }, []);

  const connect = async () => {
    try {
      await clientRef.current?.connect();
    } catch (e) {
      console.error('Connect error:', e);
    }
  };

  const disconnect = async () => {
    try {
      await clientRef.current?.disconnect();
    } catch (e) {
      console.error('Disconnect error:', e);
    }
  };

  const sendMessage = async () => {
    const client = clientRef.current;
    if (!client) return;

    try {
      // Создаем пользовательское сообщение
      await client.sendRaw({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{type: 'input_text', text: 'Tell me a short joke'}],
        },
      });

      // Запрашиваем ответ
      await client.sendResponseStrict({
        instructions: 'Расскажи короткую шутку.',
        modalities: ['text'],
        conversation: 'auto',
      });
    } catch (e) {
      console.error('Send error:', e);
    }
  };

  const clearChat = () => {
    clientRef.current?.clearChatHistory();
  };

  const isConnected = status === 'connected';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Advanced Chat (Low-Level API)</Text>
      <Text style={styles.status}>Status: {status}</Text>

      <View style={styles.controls}>
        <Button title="Connect" onPress={connect} disabled={isConnected} />
        <Button
          title="Disconnect"
          onPress={disconnect}
          disabled={!isConnected}
        />
        <Button
          title="Send Message"
          onPress={sendMessage}
          disabled={!isConnected}
        />
        <Button title="Clear Chat" onPress={clearChat} />
      </View>

      <Text style={styles.subtitle}>Chat messages: {chat.length}</Text>

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
            <Text style={styles.emptyText}>
              {!isConnected ? 'Not connected' : 'No messages yet'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f9fafb',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 12,
  },
  status: {
    fontSize: 16,
    color: '#10b981',
    marginBottom: 16,
    fontWeight: '600',
  },
  controls: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
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
    marginBottom: 12,
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
});

export default AdvancedChat;

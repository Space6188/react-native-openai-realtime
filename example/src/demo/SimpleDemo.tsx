/**
 * SimpleDemo - Простой пример использования react-native-openai-realtime
 *
 * Демонстрирует:
 * - Базовое подключение и отключение
 * - Использование useRealtime() хука
 * - Работу со встроенным чатом
 * - Отправку текстовых и голосовых сообщений
 * - Индикацию речевой активности (useSpeechActivity)
 */

import React, {useState} from 'react';
import {
  View,
  Text,
  Button,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import {
  RealTimeClient,
  useRealtime,
  useSpeechActivity,
  createSpeechActivityMiddleware,
  type ExtendedChatMsg,
} from 'react-native-openai-realtime';

// ==================== Provider ====================

const SERVER_BASE = 'http://localhost:8787'; // Замените на ваш сервер

const tokenProvider = async () => {
  const response = await fetch(`${SERVER_BASE}/realtime/session`);
  if (!response.ok) {
    throw new Error(`Failed to fetch token: ${response.status}`);
  }
  const data = await response.json();
  return data.client_secret.value;
};

export default function SimpleDemo() {
  return (
    <RealTimeClient
      tokenProvider={tokenProvider}
      // Обязательная конфигурация для транскрипции
      session={{
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'alloy',
        modalities: ['audio', 'text'],
        input_audio_transcription: {
          model: 'whisper-1', // Обязательно для транскрипции голоса!
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          silence_duration_ms: 700,
          prefix_padding_ms: 300,
        },
        instructions: 'Ты дружелюбный ассистент. Отвечай кратко и по делу.',
      }}
      // Автоматическое приветствие
      greetEnabled={true}
      greetInstructions="Привет! Я на связи и готов помочь."
      greetModalities={['audio', 'text']}
      // Middleware для отслеживания речевой активности
      incomingMiddleware={[createSpeechActivityMiddleware()]}
      // Настройки чата
      chatEnabled={true}
      chatInverted={false} // false = новые сверху
      deleteChatHistoryOnDisconnect={false}
      // Автоматическое подключение при монтировании
      autoConnect={false} // false = ручное подключение
      // Разрешить работу без микрофона (только прослушивание)
      allowConnectWithoutMic={true}
      // Колбеки для отладки
      onError={error => console.error('❌ Error:', error)}
      onOpen={dc => console.log('✅ DataChannel opened:', dc?.label)}>
      <SimpleDemoScreen />
    </RealTimeClient>
  );
}

// ==================== Screen Component ====================

function SimpleDemoScreen() {
  const {
    status,
    chat,
    connect,
    disconnect,
    sendResponseStrict,
    sendRaw,
    clearChatHistory,
  } = useRealtime();

  const {isUserSpeaking, isAssistantSpeaking} = useSpeechActivity();

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  // ==================== Handlers ====================

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error('Failed to connect:', error);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  const handleSendText = async () => {
    const text = inputText.trim();
    if (!text || !isConnected) return;

    setInputText('');
    setIsSending(true);

    try {
      // Шаг 1: Создаем пользовательское сообщение
      await sendRaw({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{type: 'input_text', text}],
        },
      });

      // Шаг 2: Запрашиваем ответ от ассистента
      await sendResponseStrict({
        instructions: 'Ответь кратко и по делу.',
        modalities: ['text'], // Только текстовый ответ
        conversation: 'auto', // Сохранить контекст
      });
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleQuickVoiceResponse = async () => {
    if (!isConnected) return;

    try {
      await sendResponseStrict({
        instructions: 'Расскажи короткую шутку.',
        modalities: ['audio', 'text'], // Голосовой + текстовый ответ
        conversation: 'auto',
      });
    } catch (error) {
      console.error('Failed to send voice response:', error);
    }
  };

  // ==================== Render ====================

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Simple OpenAI Realtime Demo</Text>
        <Text style={styles.status}>
          Status: {status}
          {isConnected && (
            <>
              {isUserSpeaking && ' 🎤 You'}
              {isAssistantSpeaking && ' 🔊 Assistant'}
            </>
          )}
        </Text>
      </View>

      {/* Connection Controls */}
      <View style={styles.controls}>
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
          title="Clear Chat"
          onPress={clearChatHistory}
          disabled={!isConnected}
        />
      </View>

      {/* Quick Actions */}
      {isConnected && (
        <View style={styles.quickActions}>
          <Button
            title="🎙️ Tell a Joke (Voice)"
            onPress={handleQuickVoiceResponse}
          />
        </View>
      )}

      {/* Chat Messages */}
      <View style={styles.chatContainer}>
        <FlatList
          data={chat}
          keyExtractor={item => item.id}
          inverted // Новые сообщения снизу
          renderItem={({item}) => (
            <ChatMessage message={item as ExtendedChatMsg} />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {!isConnected
                  ? 'Connect to start chatting'
                  : 'No messages yet. Start a conversation!'}
              </Text>
            </View>
          }
        />
      </View>

      {/* Input */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          value={inputText}
          onChangeText={setInputText}
          editable={isConnected && !isSending}
          onSubmitEditing={handleSendText}
          returnKeyType="send"
        />
        <Button
          title={isSending ? '...' : 'Send'}
          onPress={handleSendText}
          disabled={!isConnected || isSending || !inputText.trim()}
        />
      </View>

      {/* Loading Indicator */}
      {isSending && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Sending...</Text>
        </View>
      )}
    </View>
  );
}

// ==================== Chat Message Component ====================

function ChatMessage({message}: {message: ExtendedChatMsg}) {
  if (message.type === 'ui') {
    // UI сообщения (кастомные элементы)
    return (
      <View style={[styles.message, styles.messageUI]}>
        <Text style={styles.messageRole}>UI: {message.kind}</Text>
        <Text>{JSON.stringify(message.payload)}</Text>
      </View>
    );
  }

  // Текстовые сообщения из ChatStore
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
    backgroundColor: '#fff',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  status: {
    fontSize: 14,
    color: '#6b7280',
  },
  controls: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  quickActions: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  chatContainer: {
    flex: 1,
    backgroundColor: '#f9fafb',
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
    textAlign: 'center',
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
    fontSize: 16,
    color: '#111827',
  },
  messageTime: {
    fontSize: 10,
    color: '#9ca3af',
    marginTop: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
  },
  loadingContainer: {
    position: 'absolute',
    bottom: 70,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  loadingText: {
    color: '#fff',
    fontSize: 14,
  },
});

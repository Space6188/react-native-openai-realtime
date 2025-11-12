import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  RealTimeClient,
  createSpeechActivityMiddleware,
  useMicrophoneActivity,
  useRealtime,
  useSessionOptions,
  useSpeechActivity,
  type ExtendedChatMsg,
} from 'react-native-openai-realtime';
import {
  TOOL_ACK_MESSAGES,
  WORKSPACE_INSTRUCTIONS,
  WORKSPACE_TOOLS,
  type WorkspaceToolName,
} from '../provider/workspaceScenario';

const SERVER_BASE = 'http://localhost:8787';

const tokenProvider = async () => {
  const response = await fetch(`${SERVER_BASE}/realtime/session`);
  if (!response.ok) {
    throw new Error(`Failed to fetch token: ${response.status}`);
  }
  const json = await response.json();
  return json.client_secret.value;
};

const TOOL_NAMES: WorkspaceToolName[] = WORKSPACE_TOOLS.map(tool => tool.name);

export default function SimpleDemo() {
  const memoisedMiddleware = useMemo(() => [createSpeechActivityMiddleware()], []);

  return (
    <RealTimeClient
      tokenProvider={tokenProvider}
      initializeMode={{ type: 'text' }}
      session={{
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'shimmer',
        modalities: ['audio', 'text'],
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.55,
          prefix_padding_ms: 250,
          silence_duration_ms: 900,
        },
        tools: WORKSPACE_TOOLS,
        instructions: WORKSPACE_INSTRUCTIONS,
      }}
      greetEnabled={false}
      incomingMiddleware={memoisedMiddleware}
      chatEnabled
      deleteChatHistoryOnDisconnect={false}
      allowConnectWithoutMic
    >
      <SimpleDemoScreen />
    </RealTimeClient>
  );
}

function SimpleDemoScreen() {
  const {
    client,
    status,
    chat,
    connect,
    disconnect,
    clearChatHistory,
    sendResponseStrict,
    addMessage,
  } = useRealtime();

  const { isUserSpeaking, isAssistantSpeaking } = useSpeechActivity();
  const mic = useMicrophoneActivity({ mode: 'auto', pollInterval: 250 });

  const {
    initSession,
    mode,
    isModeReady,
    handleSendMessage,
    cancelAssistantNow,
    subscribeToAssistantEvents,
    clientReady,
  } = useSessionOptions(client);

  const [input, setInput] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const isConnected = status === 'connected';

  useEffect(() => {
    if (!client) return;
    const unsubscribe = subscribeToAssistantEvents(() => {
      setLog(prev => [`assistant:response_started`, ...prev].slice(0, 20));
    });
    return () => {
      try {
        unsubscribe?.();
      } catch (error) {
        console.warn('Failed to unsubscribe', error);
      }
    };
  }, [client, subscribeToAssistantEvents]);

  useEffect(() => {
    if (status === 'connected' && clientReady && isModeReady === 'idle') {
      initSession('text').catch(error => {
        console.warn('Failed to initialise text mode', error);
      });
    }
  }, [status, clientReady, isModeReady, initSession]);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error('Connect error', error);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      console.error('Disconnect error', error);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) {
      return;
    }

    setSending(true);
    try {
      await handleSendMessage(text);
      setInput('');
    } catch (error) {
      console.error('Failed to send message', error);
    } finally {
      setSending(false);
    }
  };

  const handleSwitchMode = async (nextMode: 'text' | 'voice') => {
    try {
      await initSession(nextMode, nextMode === 'voice' ? { voice: 'verse' } : undefined);
    } catch (error) {
      console.error('Failed to switch mode', error);
    }
  };

  const handleQuickInstruction = async () => {
    try {
      await sendResponseStrict({
        instructions: 'Give me a two sentence productivity tip.',
        modalities: mode === 'voice' ? ['audio', 'text'] : ['text'],
        conversation: 'auto',
      });
    } catch (error) {
      console.error('Failed to send quick instruction', error);
    }
  };

  const handleToolHint = () => {
    const suggested = TOOL_NAMES[Math.floor(Math.random() * TOOL_NAMES.length)];
    const hint = TOOL_ACK_MESSAGES[suggested];
    addMessage({
      type: 'ui',
      role: 'system',
      kind: 'hint',
      payload: {
        text: `Tool idea → ${suggested}. ${hint ?? 'Ask the assistant to try it.'}`,
      },
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.heading}>Atlas Workspace — Simple Demo</Text>
        <Text>Status: {status}</Text>
        <Text>Mode: {mode} ({isModeReady})</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <View style={styles.row}>
          <Button
            title={status === 'connecting' ? 'Connecting…' : 'Connect'}
            onPress={handleConnect}
            disabled={status === 'connecting' || isConnected}
          />
          <Button title="Disconnect" onPress={handleDisconnect} disabled={!isConnected} />
          <Button title="Clear chat" onPress={clearChatHistory} disabled={!chat.length} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Modes</Text>
        <View style={styles.row}>
          <Button title="Text mode" onPress={() => handleSwitchMode('text')} disabled={mode === 'text'} />
          <Button title="Voice mode" onPress={() => handleSwitchMode('voice')} disabled={mode === 'voice'} />
          <Button title="Stop assistant" onPress={cancelAssistantNow} disabled={!isConnected} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Activity</Text>
        <Text>User speaking: {isUserSpeaking ? '🟢' : '⚪'}</Text>
        <Text>Assistant speaking: {isAssistantSpeaking ? '🟢' : '⚪'}</Text>
        <Text>Mic active: {mic.isMicActive ? '🟢' : '⚪'} • Level: {(mic.level * 100).toFixed(0)}%</Text>
      </View>

      <View style={[styles.section, styles.chatSection]}>
        <Text style={styles.sectionTitle}>Chat ({chat.length})</Text>
        <FlatList
          data={chat}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <ChatBubble message={item as ExtendedChatMsg} />}
          inverted
          contentContainerStyle={styles.chatList}
          ListEmptyComponent={<Text style={styles.empty}>Start the conversation.</Text>}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Send message</Text>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask the assistant…"
            editable={isConnected && !sending}
          />
          <Button title={sending ? '...' : 'Send'} onPress={handleSend} disabled={!isConnected || !input.trim() || sending} />
        </View>
        <View style={styles.row}>
          <Button title="Quick tip" onPress={handleQuickInstruction} disabled={!isConnected} />
          <Button title="Suggest a tool" onPress={handleToolHint} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Assistant events</Text>
        <FlatList
          data={log}
          keyExtractor={(_, index) => String(index)}
          renderItem={({ item }) => <Text style={styles.logItem}>{item}</Text>}
          ListEmptyComponent={<Text style={styles.empty}>No events yet</Text>}
        />
      </View>

      {!isConnected && status === 'connecting' && (
        <View style={styles.overlay}>
          <ActivityIndicator />
          <Text style={styles.overlayText}>Connecting…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function ChatBubble({ message }: { message: ExtendedChatMsg }) {
  if (message.type === 'ui') {
    return (
      <View style={[styles.bubble, styles.bubbleUi]}>
        <Text style={styles.bubbleMeta}>UI · {message.kind}</Text>
        <Text style={styles.bubbleText}>{JSON.stringify(message.payload, null, 2)}</Text>
      </View>
    );
  }

  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
      <Text style={styles.bubbleMeta}>
        {message.role}
        {message.status === 'streaming' ? ' (typing…)' : ''}
      </Text>
      <Text style={styles.bubbleText}>{message.text ?? '…'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#1f2937',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  chatSection: {
    flex: 1,
    minHeight: 220,
  },
  chatList: {
    gap: 8,
    paddingBottom: 8,
  },
  bubble: {
    padding: 12,
    borderRadius: 10,
    maxWidth: '90%',
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: '#dbeafe',
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5f5',
  },
  bubbleUi: {
    alignSelf: 'center',
    backgroundColor: '#fef3c7',
  },
  bubbleMeta: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
  },
  bubbleText: {
    fontSize: 14,
    color: '#0f172a',
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  empty: {
    textAlign: 'center',
    color: '#94a3b8',
  },
  logItem: {
    fontSize: 12,
    color: '#0f172a',
    marginBottom: 2,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
  },
  overlayText: {
    marginTop: 8,
    color: '#0f172a',
  },
});

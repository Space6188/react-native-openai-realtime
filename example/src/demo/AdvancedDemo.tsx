import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Button,
  FlatList,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  RealTimeClient,
  createSpeechActivityMiddleware,
  useMicrophoneActivity,
  useRealtime,
  useSessionOptions,
  useSpeechActivity,
  VOICE_IDS,
  type ExtendedChatMsg,
  type IncomingMiddleware,
  type OutgoingMiddleware,
  type RealTimeClientHandle,
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

const MOCK_TOOLS = {
  list_workspaces: () => ({
    items: [
      {
        id: 'studio-soho',
        name: 'Soho Workshop Loft',
        city: 'New York',
        capacity: 18,
        tags: ['whiteboard', 'lighting']
      },
    ],
  }),
  list_last_minute_offers: () => ({
    items: [
      {
        id: 'deal-nyc',
        label: 'Sunrise Sprint Slot',
        starts_at: '2025-01-12T08:30:00-05:00',
        discount: 25,
      },
    ],
  }),
};

const incomingMiddleware: IncomingMiddleware[] = [
  createSpeechActivityMiddleware(),
  async ({ event }) => {
    if (
      event?.type === 'response.audio_transcript.delta' &&
      !event?.delta?.trim()
    ) {
      return 'stop';
    }
    return;
  },
];

const outgoingMiddleware: OutgoingMiddleware[] = [
  event => {
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
];

export default function AdvancedDemo() {
  const clientRef = useRef<RealTimeClientHandle | null>(null);

  const onToolCall = useCallback(
    async ({ name, args }: { name: WorkspaceToolName; args: any }) => {
      if (name === 'calculate_workspace_quote') {
        return {
          quote_id: `quote-${Date.now()}`,
          subtotal: 480,
          currency: 'USD',
          city: args.city,
          capacity: args.capacity,
        };
      }
      if (name in MOCK_TOOLS) {
        return MOCK_TOOLS[name as keyof typeof MOCK_TOOLS]();
      }
      return undefined;
    },
    [],
  );

  return (
    <RealTimeClient
      ref={clientRef}
      tokenProvider={tokenProvider}
      session={{
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'alloy',
        modalities: ['text'],
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: null,
        tools: WORKSPACE_TOOLS,
        instructions: WORKSPACE_INSTRUCTIONS,
      }}
      incomingMiddleware={incomingMiddleware}
      outgoingMiddleware={outgoingMiddleware}
      policyIsMeaningfulText={text => text.trim().length >= 2}
      chatEnabled
      deleteChatHistoryOnDisconnect={false}
      allowConnectWithoutMic
      onToolCall={onToolCall}
      autoConnect={false}
    >
      <AdvancedDemoScreen clientRef={clientRef} />
    </RealTimeClient>
  );
}

type Props = {
  clientRef: React.MutableRefObject<RealTimeClientHandle | null>;
};

function AdvancedDemoScreen({ clientRef }: Props) {
  const {
    client,
    status,
    chat,
    connect,
    disconnect,
    sendResponse,
    sendResponseStrict,
    updateSession,
    addMessage,
    clearAdded,
    clearChatHistory,
  } = useRealtime();

  const { isUserSpeaking, isAssistantSpeaking } = useSpeechActivity();
  const mic = useMicrophoneActivity({ pollInterval: 120, mode: 'auto' });

  const {
    initSession,
    handleSendMessage,
    mode,
    isModeReady,
    cancelAssistantNow,
    clientReady,
  } = useSessionOptions(client);

  const [text, setText] = useState('Show available studios in New York.');
  const [modeLog, setModeLog] = useState<string[]>([]);
  const [manualTools, setManualTools] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState('alloy');

  const isConnected = status === 'connected';

  useEffect(() => {
    if (!client) return;
    const off = client.on('assistant:response_started', ({ responseId }) => {
      setModeLog(prev => [`assistant:response_started ${responseId}`, ...prev].slice(0, 15));
    });
    const offTool = client.on('tool:call_done', ({ call_id, name, args }) => {
      setModeLog(prev => [`tool:call_done ${name}`, ...prev].slice(0, 15));
      if (manualTools) {
        client.sendToolOutput(call_id, { acknowledged: true, args });
        client.sendResponse({
          instructions: `The ${name} tool finished in manual mode.`,
          modalities: ['text'],
        });
      }
    });
    return () => {
      try {
        off?.();
        offTool?.();
      } catch (error) {
        console.warn('Failed to clean listeners', error);
      }
    };
  }, [client, manualTools]);

  useEffect(() => {
    if (status === 'connected' && clientReady && isModeReady === 'idle') {
      initSession('text').catch(error => console.warn('initSession failed', error));
    }
  }, [status, clientReady, isModeReady, initSession]);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error('connect error', error);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch (error) {
      console.error('disconnect error', error);
    }
  };

  const handleSend = async () => {
    const value = text.trim();
    if (!value) return;
    await handleSendMessage(value);
    setText('');
  };

  const handleSwitch = async (nextMode: 'text' | 'voice') => {
    await initSession(nextMode, nextMode === 'voice' ? { voice: selectedVoice } : undefined);
    setModeLog(prev => [`mode → ${nextMode}`, ...prev].slice(0, 15));
  };

  const handleVoiceChange = (voice: string) => {
    setSelectedVoice(voice);
    updateSession({ voice });
  };

  const handleEnableMic = async () => {
    try {
      await client?.enableMicrophone?.();
    } catch (error) {
      console.error('enableMicrophone failed', error);
    }
  };

  const handleDisableMic = async () => {
    try {
      await client?.disableMicrophone?.();
    } catch (error) {
      console.error('disableMicrophone failed', error);
    }
  };

  const handleQuickQuote = async () => {
    await sendResponseStrict({
      instructions:
        'Gather the city, capacity, start_time, end_time, and layout before calling calculate_workspace_quote.',
      modalities: ['text'],
      conversation: 'auto',
    });
  };

  const handleAckHint = () => {
    const entry = Object.entries(TOOL_ACK_MESSAGES)[
      Math.floor(Math.random() * Object.keys(TOOL_ACK_MESSAGES).length)
    ] as [WorkspaceToolName, string];
    addMessage({
      type: 'ui',
      role: 'assistant',
      kind: 'acknowledgement_example',
      payload: {
        tool: entry[0],
        example: entry[1],
      },
    });
  };

  const handleResetUi = () => {
    clearAdded();
    clearChatHistory();
  };

  const fullyConnected = client?.getClient?.()?.isFullyConnected?.();

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.heading}>Atlas Workspace · Advanced Demo</Text>
        <Text>Status: {status}</Text>
        <Text>Mode: {mode} ({isModeReady})</Text>
        <Text>Fully connected: {fullyConnected ? 'yes' : 'no'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <View style={styles.row}>
          <Button title="Connect" onPress={handleConnect} disabled={isConnected} />
          <Button title="Disconnect" onPress={handleDisconnect} disabled={!isConnected} />
          <Button title="Cancel response" onPress={cancelAssistantNow} disabled={!isConnected} />
        </View>
        <View style={styles.row}>
          <Button title="Enable mic" onPress={handleEnableMic} disabled={!isConnected} />
          <Button title="Disable mic" onPress={handleDisableMic} disabled={!isConnected} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Modes</Text>
        <View style={styles.row}>
          <Button title="Text" onPress={() => handleSwitch('text')} disabled={mode === 'text'} />
          <Button title="Voice" onPress={() => handleSwitch('voice')} disabled={mode === 'voice'} />
        </View>
        {mode === 'voice' && (
          <View style={styles.voiceRow}>
            {VOICE_IDS.map(item => (
              <TouchableOpacity
                key={item}
                style={[styles.voicePill, selectedVoice === item && styles.voiceSelected]}
                onPress={() => handleVoiceChange(item)}
              >
                <Text
                  style={[
                    styles.voiceText,
                    selectedVoice === item && styles.voiceTextSelected,
                  ]}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Speech & Microphone</Text>
        <Text>User speaking: {isUserSpeaking ? '🟢' : '⚪'}</Text>
        <Text>Assistant speaking: {isAssistantSpeaking ? '🟢' : '⚪'}</Text>
        <Text>Mic active: {mic.isMicActive ? '🟢' : '⚪'} • Capturing: {mic.isCapturing ? '🟢' : '⚪'}</Text>
        <Text>Mic level: {(mic.level * 100).toFixed(0)}%</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Manual tool mode</Text>
        <View style={styles.rowBetween}>
          <Text>Send tool outputs manually</Text>
          <Switch value={manualTools} onValueChange={setManualTools} />
        </View>
      </View>

      <View style={[styles.section, styles.chatSection]}>
        <Text style={styles.sectionTitle}>Chat ({chat.length})</Text>
        <FlatList
          data={chat}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <ChatMessage message={item as ExtendedChatMsg} />}
          inverted
          contentContainerStyle={styles.chatList}
          ListEmptyComponent={<Text style={styles.empty}>Connect to start chatting.</Text>}
        />
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            multiline
            placeholder="Ask about workspaces, quotes, or bookings…"
          />
          <Button title="Send" onPress={handleSend} disabled={!text.trim()} />
        </View>
        <View style={styles.row}>
          <Button title="Quick quote instruction" onPress={handleQuickQuote} disabled={!isConnected} />
          <Button title="Show ack example" onPress={handleAckHint} />
          <Button title="Reset UI" onPress={handleResetUi} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mode & tool log</Text>
        <FlatList
          data={modeLog}
          keyExtractor={(_, index) => String(index)}
          renderItem={({ item }) => <Text style={styles.logItem}>{item}</Text>}
          ListEmptyComponent={<Text style={styles.empty}>Interact with the demo to populate the log.</Text>}
        />
      </View>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function ChatMessage({ message }: { message: ExtendedChatMsg }) {
  if (message.type === 'ui') {
    return (
      <View style={[styles.bubble, styles.uiBubble]}>
        <Text style={styles.meta}>UI · {message.kind}</Text>
        <Text style={styles.body}>{JSON.stringify(message.payload, null, 2)}</Text>
      </View>
    );
  }

  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
      <Text style={styles.meta}>
        {message.role}
        {message.status === 'streaming' && ' (typing…)'}
      </Text>
      <Text style={styles.body}>{message.text ?? '…'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#eef2ff',
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#cbd5f5',
    backgroundColor: '#fff',
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
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
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatSection: {
    minHeight: 280,
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
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#dbeafe',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#93c5fd',
  },
  uiBubble: {
    alignSelf: 'center',
    backgroundColor: '#fde68a',
  },
  meta: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
  },
  body: {
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
    color: '#64748b',
  },
  logItem: {
    fontSize: 12,
    color: '#1f2937',
    marginBottom: 4,
  },
  voiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  voicePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
  },
  voiceSelected: {
    backgroundColor: '#3b82f6',
  },
  voiceText: {
    color: '#0f172a',
  },
  voiceTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
});

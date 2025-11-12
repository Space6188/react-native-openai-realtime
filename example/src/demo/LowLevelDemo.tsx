import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Button,
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
import {
  WORKSPACE_INSTRUCTIONS,
  WORKSPACE_TOOLS,
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

const createSuccessHandler = (
  setStatus: React.Dispatch<React.SetStateAction<string>>,
  pushLog: (message: string) => void,
) => {
  const callbacks: SuccessCallbacks = {
    onPeerConnectionCreatingStarted: () => pushLog('Creating PeerConnection…'),
    onPeerConnectionCreated: pc => pushLog(`PeerConnection created (${pc.connectionState})`),
    onRTCPeerConnectionStateChange: state => {
      setStatus(state);
      pushLog(`connectionState → ${state}`);
    },
    onDataChannelOpen: channel => pushLog(`DataChannel opened (${channel.label})`),
    onDataChannelClose: () => pushLog('DataChannel closed'),
    onGetUserMediaSetted: stream => pushLog(`getUserMedia OK (tracks: ${stream.getTracks().length})`),
    onRemoteStreamSetted: stream => pushLog(`Remote stream ready (${stream.getTracks().length} tracks)`),
    onIceGatheringComplete: () => pushLog('ICE gathering complete'),
    onMicrophonePermissionGranted: () => pushLog('Microphone permission granted'),
    onMicrophonePermissionDenied: () => pushLog('Microphone permission denied'),
  };

  const onSuccess = (stage: string) => {
    pushLog(`SUCCESS · ${stage}`);
  };

  return new SuccessHandler(callbacks, onSuccess);
};

const createErrorHandler = (pushLog: (message: string) => void) =>
  new ErrorHandler((event: ErrorEvent) => {
    pushLog(`ERROR [${event.severity}] ${event.stage}: ${event.error?.message ?? event.error}`);
  });

export default function LowLevelDemo() {
  const clientRef = useRef<RealtimeClientClass | null>(null);
  const [status, setStatus] = useState('idle');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const pushLog = (message: string) => {
    setLogs(prev => [`${new Date().toLocaleTimeString()} · ${message}`, ...prev].slice(0, 60));
  };

  useEffect(() => {
    const successHandler = createSuccessHandler(setStatus, pushLog);
    const errorHandler = createErrorHandler(pushLog);

    const client = new RealtimeClientClass(
      {
        tokenProvider,
        webrtc: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
          dataChannelLabel: 'oai-events',
        },
        session: {
          model: 'gpt-4o-realtime-preview-2024-12-17',
          voice: 'shimmer',
          modalities: ['text'],
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: null,
          tools: WORKSPACE_TOOLS,
          instructions: WORKSPACE_INSTRUCTIONS,
        },
        autoSessionUpdate: false,
        hooks: {
          onOpen: () => pushLog('Connected (onOpen)'),
          onEvent: evt => {
            if (typeof evt?.type === 'string') {
              pushLog(`event · ${evt.type}`);
            }
          },
        },
        middleware: {
          incoming: [async ({ event }) => {
            if (event?.type === 'response.text.delta' && !event?.delta?.trim()) {
              return 'stop';
            }
            return;
          }],
          outgoing: [event => {
            if (
              event?.type === 'conversation.item.create' &&
              event.item?.content?.[0]?.type === 'input_text'
            ) {
              const text = (event.item.content[0].text || '').trim();
              if (!text) {
                pushLog('Blocked empty message');
                return 'stop';
              }
              event.item.content[0].text = text;
            }
            return event;
          }],
        },
        chat: {
          enabled: true,
          isMeaningfulText: text => !!text.trim(),
        },
        policy: {
          isMeaningfulText: text => text.trim().length >= 2,
        },
        allowConnectWithoutMic: true,
        deleteChatHistoryOnDisconnect: false,
      },
      successHandler,
      errorHandler,
    );

    clientRef.current = client;
    const detach = attachChatAdapter(client, setChat);
    const offStatus = client.onConnectionStateChange(state => {
      setStatus(state);
      pushLog(`connectionState → ${state}`);
    });

    return () => {
      try {
        detach();
        offStatus?.();
      } catch (error) {
        console.warn('Cleanup error', error);
      }
      client.disconnect().catch(error => console.warn('Disconnect error', error));
    };
  }, []);

  const connect = async () => {
    try {
      pushLog('Connecting…');
      await clientRef.current?.connect();
      const isConnected = clientRef.current?.isFullyConnected?.();
      pushLog(`isFullyConnected → ${isConnected}`);
    } catch (error) {
      pushLog(`Connect error: ${error}`);
    }
  };

  const disconnect = async () => {
    try {
      pushLog('Disconnecting…');
      await clientRef.current?.disconnect();
    } catch (error) {
      pushLog(`Disconnect error: ${error}`);
    }
  };

  const sendMessage = async () => {
    try {
      pushLog('Sending message…');
      await clientRef.current?.sendRaw({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'List a workspace with natural light in New York.' }],
        },
      });
      await clientRef.current?.sendResponseStrict({
        instructions: 'Recommend one workspace based on the request.',
        modalities: ['text'],
        conversation: 'auto',
      });
    } catch (error) {
      pushLog(`Send error: ${error}`);
    }
  };

  const enableMic = async () => {
    try {
      await clientRef.current?.enableMicrophone();
      pushLog('enableMicrophone() completed');
    } catch (error) {
      pushLog(`enableMicrophone error: ${error}`);
    }
  };

  const disableMic = async () => {
    try {
      await clientRef.current?.disableMicrophone();
      pushLog('disableMicrophone() completed');
    } catch (error) {
      pushLog(`disableMicrophone error: ${error}`);
    }
  };

  const clearChat = () => {
    clientRef.current?.clearChatHistory();
    pushLog('Chat history cleared');
  };

  const client = clientRef.current;
  const peerState = client?.getPeerConnection()?.connectionState ?? 'n/a';
  const dcState = client?.getDataChannel()?.readyState ?? 'n/a';

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.heading}>Low-level RealtimeClientClass demo</Text>
        <Text>Status: {status}</Text>
        <Text>PeerConnection: {peerState}</Text>
        <Text>DataChannel: {dcState}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Actions</Text>
        <View style={styles.row}>
          <Button title="Connect" onPress={connect} disabled={status === 'connected'} />
          <Button title="Disconnect" onPress={disconnect} disabled={status !== 'connected'} />
        </View>
        <View style={styles.row}>
          <Button title="Send message" onPress={sendMessage} disabled={status !== 'connected'} />
          <Button title="Enable mic" onPress={enableMic} disabled={status !== 'connected'} />
          <Button title="Disable mic" onPress={disableMic} disabled={status !== 'connected'} />
        </View>
        <Button title="Clear chat" onPress={clearChat} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Chat ({chat.length})</Text>
        <FlatList
          data={chat}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === 'user' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <Text style={styles.meta}>{item.role}</Text>
              <Text style={styles.body}>{item.text || '…'}</Text>
              <Text style={styles.metaSmall}>
                {item.status} · {new Date(item.time).toLocaleTimeString()}
              </Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Chat is empty</Text>}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Logs ({logs.length})</Text>
        <FlatList
          data={logs}
          keyExtractor={(_, index) => String(index)}
          renderItem={({ item }) => <Text style={styles.logItem}>{item}</Text>}
          ListEmptyComponent={<Text style={styles.empty}>Interact with the demo to see logs</Text>}
        />
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  section: {
    padding: 16,
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
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  bubble: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  userBubble: {
    backgroundColor: '#dbeafe',
    alignSelf: 'flex-end',
  },
  assistantBubble: {
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5f5',
    alignSelf: 'flex-start',
  },
  meta: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
  },
  metaSmall: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 4,
  },
  body: {
    fontSize: 14,
    color: '#0f172a',
  },
  empty: {
    textAlign: 'center',
    color: '#94a3b8',
  },
  logItem: {
    fontSize: 12,
    color: '#0f172a',
    marginBottom: 4,
  },
});

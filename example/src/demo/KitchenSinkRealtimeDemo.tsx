/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useRealtime,
  useSpeechActivity,
  useMicrophoneActivity,
  VOICE_IDS,
  type VoiceId,
} from 'react-native-openai-realtime';

type Props = {
  events: Array<{t: number; type: string; raw: any}>;
  onClearEvents: () => void;
};

export const KitchenSinkRealtimeDemo: React.FC<Props> = ({
  events,
  onClearEvents,
}) => {
  const {
    client,
    status,
    chat,
    connect,
    disconnect,
    sendResponse,
    sendResponseStrict,
    updateSession,
    sendRaw,
    addMessage,
    clearAdded,
    clearChatHistory,
  } = useRealtime();

  const speech = useSpeechActivity();
  const mic = useMicrophoneActivity({mode: 'auto', pollInterval: 60});

  const [inputText, setInputText] = useState('');
  const [selectedVoice, setSelectedVoice] = useState<VoiceId>('alloy');
  const [vadThreshold, setVadThreshold] = useState(0.5);
  const [silenceMs, setSilenceMs] = useState(700);
  const [textOnly, setTextOnly] = useState(false);
  const [pending, setPending] = useState(false);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [manualToolMode, setManualToolMode] = useState(false); // вручную отправлять tool output

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  // Подписки на события (демо)
  useEffect(() => {
    if (!client) return;

    const u1 = client.on('user:item_started', ({itemId}: {itemId: string}) =>
      console.log('[user:item_started]', itemId),
    );
    const u2 = client.on(
      'user:delta',
      ({itemId, delta}: {itemId: string; delta: string}) =>
        console.log('[user:delta]', itemId, delta),
    );
    const u3 = client.on(
      'user:completed',
      ({itemId, transcript}: {itemId: string; transcript: string}) =>
        console.log('[user:completed]', itemId, transcript),
    );
    const a1 = client.on(
      'assistant:response_started',
      ({responseId}: {responseId: string}) =>
        console.log('[assistant:response_started]', responseId),
    );
    const a2 = client.on(
      'assistant:delta',
      ({
        responseId,
        delta,
        channel,
      }: {
        responseId: string;
        delta: string;
        channel: string;
      }) => console.log('[assistant:delta]', channel, responseId, delta),
    );
    const a3 = client.on(
      'assistant:completed',
      ({responseId, status}: {responseId: string; status: string}) =>
        console.log('[assistant:completed]', responseId, status),
    );
    const t1 = client.on(
      'tool:call_delta',
      ({
        call_id,
        name,
        delta,
      }: {
        call_id: string;
        name: string;
        delta: string;
      }) => console.log('[tool:call_delta]', name, delta, call_id),
    );
    const t2 = client.on(
      'tool:call_done',
      ({call_id, name, args}: {call_id: string; name: string; args: any}) => {
        console.log('[tool:call_done]', name, args);
        if (manualToolMode) {
          const output = {ok: true, manual: true, echoArgs: args};
          client.sendToolOutput(call_id, output);
          sendResponse({
            instructions:
              'Вы вызвали инструмент ' +
              name +
              ' с аргументами ' +
              JSON.stringify(args),
            modalities: ['text'],
            conversation: 'default',
          });
        }
      },
    );
    const er = client.on(
      'error',
      ({scope, error}: {scope: string; error: any}) =>
        console.warn('[server error]', scope, error),
    );

    return () => {
      try {
        u1();
        u2();
        u3();
        a1();
        a2();
        a3();
        t1();
        t2();
        er();
      } catch {}
    };
  }, [client, manualToolMode, sendResponse]);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (e) {
      console.warn('connect error', e);
    }
  };
  const handleDisconnect = async () => {
    try {
      await disconnect();
    } catch {}
  };

  const handleUpdateVoice = (voice: VoiceId) => {
    setSelectedVoice(voice);
    updateSession({voice});
  };

  const applyVAD = () => {
    updateSession({
      turn_detection: {
        type: 'server_vad',
        threshold: vadThreshold,
        silence_duration_ms: silenceMs,
        prefix_padding_ms: 300,
      },
    });
  };

  const toggleTools = () => {
    setToolsEnabled(v => !v);
    updateSession({
      tools: !toolsEnabled ? undefined : [], // отключаем инструменты пустым массивом
    });
  };

  const sendQuickResponse = async () => {
    await sendResponseStrict({
      instructions: 'Кратко опиши, что ты умеешь.',
      modalities: textOnly ? ['text'] : ['text', 'audio'],
      conversation: 'default',
    });
  };

  const sendOneOff = async () => {
    await sendResponseStrict({
      instructions: 'Этот ответ НЕ должен попадать в историю разговоров.',
      modalities: ['text'],
      conversation: 'none',
    });
  };

  const handleCancel = async () => {
    await sendRaw({type: 'response.cancel'});
  };

  const handleSubmitUserText = async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText('');
    addMessage({role: 'user', type: 'text', text, ts: Date.now()});
    await sendUserText(sendRaw, text);
  };

  // PTT
  const [ptt, setPtt] = useState(false);
  const enablePTTMode = () => {
    setPtt(true);
    updateSession({turn_detection: undefined}); // отключаем VAD
  };
  const disablePTTMode = () => {
    setPtt(false);
    applyVAD();
  };

  const pttDown = () => {
    // включить локальный трек (если был выключен)
    try {
      const local = client?.getLocalStream?.();
      local?.getAudioTracks?.()?.forEach((t: any) => (t.enabled = true));
    } catch {}
  };
  const pttUp = async () => {
    await sendRaw({type: 'input_audio_buffer.commit'});
    await sendRaw({type: 'response.create'});
    await sendRaw({type: 'input_audio_buffer.clear'});
  };

  const toggleMicEnabled = () => {
    try {
      const local = client?.getLocalStream?.();
      local?.getAudioTracks?.()?.forEach((t: any) => (t.enabled = !t.enabled));
    } catch {}
  };

  const pcInfo = useMemo(() => {
    try {
      const pc = client?.getPeerConnection?.();
      const dc = client?.getDataChannel?.();
      const remote = client?.getRemoteStream?.();
      const local = client?.getLocalStream?.();
      return {
        pcState: pc?.connectionState ?? 'n/a',
        ice: pc?.iceConnectionState ?? 'n/a',
        dc: dc?.readyState ?? 'n/a',
        localTracks: local?.getTracks?.().length ?? 0,
        remoteTracks: remote?.getTracks?.().length ?? 0,
      };
    } catch {
      return {
        pcState: 'n/a',
        ice: 'n/a',
        dc: 'n/a',
        localTracks: 0,
        remoteTracks: 0,
      };
    }
  }, [client]);

  return (
    <View style={styles.root}>
      <Text style={styles.h1}>
        OpenAI Realtime — Kitchen Sink (без лишних контекстов)
      </Text>

      {/* Подключение */}
      <View style={styles.card}>
        <Text style={styles.title}>Подключение</Text>
        <Text>status: {status}</Text>
        <Text>
          PC: {pcInfo.pcState} | ICE: {pcInfo.ice} | DC: {pcInfo.dc} | Local:{' '}
          {pcInfo.localTracks} | Remote: {pcInfo.remoteTracks}
        </Text>
        <View style={styles.row}>
          <Button
            title="Connect"
            onPress={handleConnect}
            disabled={isConnecting || isConnected}
          />
          <Button
            title="Disconnect"
            onPress={handleDisconnect}
            disabled={!isConnected && !isConnecting}
          />
          <Button
            title="Cancel response"
            onPress={handleCancel}
            disabled={!isConnected}
          />
        </View>
        <View style={styles.row}>
          <Button title="Clear chat" onPress={clearChatHistory} />
          <Button title="Clear added" onPress={clearAdded} />
        </View>
      </View>

      {/* Голос/микрофон */}
      <View style={styles.card}>
        <Text style={styles.title}>Микрофон и речь</Text>
        <Text>
          isCapturing: {String(mic.isCapturing)} | micActive:{' '}
          {String(mic.isMicActive)}
        </Text>
        <View style={styles.levelBar}>
          <View
            style={[
              styles.levelFill,
              {width: `${Math.round(mic.level * 100)}%`},
            ]}
          />
        </View>
        <Text>level: {Math.round(mic.level * 100)}%</Text>
        <Text>
          userSpeaking: {String(speech.isUserSpeaking)} | assistantSpeaking:{' '}
          {String(speech.isAssistantSpeaking)}
        </Text>

        <View style={styles.row}>
          <Button title="Mute/Unmute mic" onPress={toggleMicEnabled} />
          <View style={styles.rowItem}>
            <Text>Text only</Text>
            <Switch value={textOnly} onValueChange={setTextOnly} />
          </View>
          <Button
            title="Quick answer"
            onPress={sendQuickResponse}
            disabled={!isConnected}
          />
          <Button
            title="One-off (no history)"
            onPress={sendOneOff}
            disabled={!isConnected}
          />
        </View>
      </View>

      {/* PTT */}
      <View style={styles.card}>
        <Text style={styles.title}>PTT (ручной input_audio_buffer)</Text>
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text>PTT mode</Text>
            <Switch
              value={ptt}
              onValueChange={v => (v ? enablePTTMode() : disablePTTMode())}
            />
          </View>
          <TouchableOpacity
            disabled={!isConnected || !ptt}
            onPressIn={pttDown}
            onPressOut={pttUp}
            style={[styles.pttBtn, (!isConnected || !ptt) && {opacity: 0.5}]}>
            <Text style={styles.pttText}>Hold to talk</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.row}>
          <Button
            title="Commit"
            onPress={() => sendRaw({type: 'input_audio_buffer.commit'})}
            disabled={!isConnected || !ptt}
          />
          <Button
            title="Clear"
            onPress={() => sendRaw({type: 'input_audio_buffer.clear'})}
            disabled={!isConnected || !ptt}
          />
          <Button
            title="Ask (response.create)"
            onPress={() => sendRaw({type: 'response.create'})}
            disabled={!isConnected || !ptt}
          />
        </View>
      </View>

      {/* Сессия */}
      <View style={styles.card}>
        <Text style={styles.title}>Сессия: Voice / VAD / Tools</Text>

        <ScrollView horizontal contentContainerStyle={styles.row}>
          {VOICE_IDS.map((v: VoiceId) => (
            <TouchableOpacity
              key={v}
              style={[
                styles.voicePill,
                v === selectedVoice && styles.voicePillActive,
              ]}
              onPress={() => handleUpdateVoice(v as VoiceId)}>
              <Text
                style={[
                  styles.voicePillText,
                  v === selectedVoice && styles.voicePillTextActive,
                ]}>
                {v}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.row}>
          <Text>VAD threshold: {vadThreshold.toFixed(2)}</Text>
          <View style={styles.row}>
            <Button
              title="-0.05"
              onPress={() =>
                setVadThreshold(x => Math.max(0, Number((x - 0.05).toFixed(2))))
              }
            />
            <Button
              title="+0.05"
              onPress={() =>
                setVadThreshold(x => Math.min(1, Number((x + 0.05).toFixed(2))))
              }
            />
          </View>
        </View>
        <View style={styles.row}>
          <Text>silence_ms: {silenceMs}</Text>
          <View style={styles.row}>
            <Button
              title="-100"
              onPress={() => setSilenceMs(x => Math.max(100, x - 100))}
            />
            <Button
              title="+100"
              onPress={() => setSilenceMs(x => Math.min(3000, x + 100))}
            />
          </View>
        </View>

        <View style={styles.row}>
          <Button title="Apply VAD" onPress={applyVAD} />
          <View style={styles.rowItem}>
            <Text>Tools enabled</Text>
            <Switch value={toolsEnabled} onValueChange={toggleTools} />
          </View>
          <View style={styles.rowItem}>
            <Text>Manual tool output</Text>
            <Switch value={manualToolMode} onValueChange={setManualToolMode} />
          </View>
        </View>
      </View>

      {/* Чат */}
      <View style={styles.card}>
        <Text style={styles.title}>Чат (встроенный ChatStore + ваши UI)</Text>
        <View style={styles.chatBox}>
          <FlatList
            data={chat as any[]}
            keyExtractor={m => (m as any).id}
            renderItem={({item}: any) => (
              <View
                style={[
                  styles.msg,
                  item.role === 'user' ? styles.msgUser : styles.msgAssistant,
                ]}>
                <Text style={styles.msgRole}>{item.role}</Text>
                {item.type === 'text' ? (
                  <Text style={styles.msgText}>{item.text || ''}</Text>
                ) : (
                  <Text>UI: {item.kind}</Text>
                )}
              </View>
            )}
            inverted
          />
        </View>
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            placeholder="Напиши сообщение"
            multiline
            value={inputText}
            onChangeText={setInputText}
            editable={isConnected}
          />
          <TouchableOpacity
            onPress={async () => {
              if (!isConnected) return;
              setPending(true);
              try {
                await handleSubmitUserText();
              } finally {
                setPending(false);
              }
            }}
            style={[styles.sendBtn, !isConnected && {opacity: 0.6}]}
            disabled={!isConnected || pending}>
            {pending ? (
              <ActivityIndicator />
            ) : (
              <Text style={styles.sendBtnText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Сырые события onEvent */}
      <View style={styles.card}>
        <Text style={styles.title}>
          onEvent — лог входящих событий (первые 20 из {events.length})
        </Text>
        <View style={styles.row}>
          <Button title="Clear events" onPress={onClearEvents} />
        </View>
        <View style={{maxHeight: 300}}>
          <FlatList
            data={events.slice(0, 20)}
            keyExtractor={(_, i) => String(i)}
            renderItem={({item}) => (
              <View style={styles.eventRow}>
                <Text style={styles.eventTs}>
                  {new Date(item.t).toLocaleTimeString()}
                </Text>
                <Text style={styles.eventType}>{item.type}</Text>
              </View>
            )}
          />
        </View>
      </View>

      {/* Доп. кнопки под чатом */}
      <View style={{height: 40}} />
      <View style={styles.row}>
        <Button
          title="Add UI bubble"
          onPress={() =>
            addMessage({
              type: 'ui',
              kind: 'hint',
              role: 'system',
              payload: {text: 'Подсказка интерфейса ✨'},
            })
          }
        />
        <Button title="Clear added" onPress={clearAdded} />
        <Button title="Clear chat" onPress={clearChatHistory} />
      </View>
    </View>
  );
};

function sendUserText(
  sendRaw: (e: any) => Promise<void> | void,
  text: string,
): Promise<void> {
  return Promise.resolve()
    .then(() =>
      sendRaw({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{type: 'input_text', text}],
        },
      }),
    )
    .then(() => sendRaw({type: 'response.create'})) as Promise<void>;
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 16, paddingTop: Platform.OS === 'ios' ? 60 : 16},
  h1: {fontSize: 20, fontWeight: '700', marginBottom: 12},
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  title: {fontSize: 16, fontWeight: '700', marginBottom: 8},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap'},
  rowItem: {flexDirection: 'row', alignItems: 'center', gap: 6},
  levelBar: {
    height: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 6,
    overflow: 'hidden',
    marginVertical: 6,
  },
  levelFill: {height: 8, backgroundColor: '#10B981'},
  voicePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#94a3b8',
  },
  voicePillActive: {backgroundColor: '#1d4ed8', borderColor: '#1d4ed8'},
  voicePillText: {color: '#1f2937'},
  voicePillTextActive: {color: '#fff'},
  chatBox: {
    height: 220,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    marginBottom: 8,
  },
  msg: {padding: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9'},
  msgUser: {backgroundColor: '#f8fafc'},
  msgAssistant: {backgroundColor: '#eef2ff'},
  msgRole: {fontSize: 12, color: '#64748b'},
  msgText: {fontSize: 14, color: '#0f172a'},
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 6,
    padding: 10,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: '#fff',
  },
  sendBtn: {
    paddingHorizontal: 14,
    height: 44,
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: {fontWeight: '700', color: '#111827'},
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  eventTs: {width: 64, color: '#64748b', fontVariant: ['tabular-nums']},
  eventType: {flex: 1, color: '#0f172a'},
  pttBtn: {
    paddingHorizontal: 14,
    height: 44,
    backgroundColor: '#0ea5e9',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pttText: {color: '#fff', fontWeight: '700'},
});

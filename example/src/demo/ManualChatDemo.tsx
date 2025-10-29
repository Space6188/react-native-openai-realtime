import React, {useEffect, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {RealTimeClient, useRealtime} from 'react-native-openai-realtime';

export const ManualChatDemoWrapper: React.FC = () => {
  return (
    <RealTimeClient
      // ВАЖНО: сюда подставь свой боевой provider (иначе экран упадёт при монтировании)
      tokenProvider={async () => {
        throw new Error('plug your tokenProvider');
      }}
      chatEnabled={false}
      attachChat={false}
      autoConnect={true}>
      <ManualChatDemo />
    </RealTimeClient>
  );
};

const ManualChatDemo: React.FC = () => {
  const {client, status, connect, disconnect} = useRealtime();
  const [chat, setChat] = useState<
    Array<{id: string; role: 'user' | 'assistant'; text: string}>
  >([]);

  useEffect(() => {
    if (!client) return;

    const add = (role: 'user' | 'assistant', id: string, delta: string) => {
      setChat(prev => {
        const idx = prev.findIndex(m => m.id === id);
        if (idx === -1) {
          return [...prev, {id, role, text: delta}];
        }
        const copy = [...prev];
        copy[idx] = {...copy[idx], text: copy[idx].text + delta};
        return copy;
      });
    };

    const uStart = client.on(
      'user:item_started',
      ({itemId}: {itemId: string}) => {
        setChat(prev => [...prev, {id: itemId, role: 'user', text: ''}]);
      },
    );
    const uDelta = client.on(
      'user:delta',
      ({itemId, delta}: {itemId: string; delta: string}) =>
        add('user', itemId, delta),
    );
    const aStart = client.on(
      'assistant:response_started',
      ({responseId}: {responseId: string}) => {
        setChat(prev => [
          ...prev,
          {id: responseId, role: 'assistant', text: ''},
        ]);
      },
    );
    const aDelta = client.on(
      'assistant:delta',
      ({responseId, delta}: {responseId: string; delta: string}) =>
        add('assistant', responseId, delta),
    );

    connect().catch(() => {});

    return () => {
      try {
        uStart();
        uDelta();
        aStart();
        aDelta();
      } catch {}
      disconnect?.().catch(() => {});
    };
  }, [client, connect, disconnect]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Manual chat (no ChatStore) — {status}</Text>
      <FlatList
        data={chat}
        keyExtractor={m => m.id}
        renderItem={({item}) => (
          <View style={styles.msg}>
            <Text style={styles.role}>{item.role}</Text>
            <Text>{item.text}</Text>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, padding: 12},
  title: {fontWeight: '700', marginBottom: 8},
  msg: {paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#eee'},
  role: {fontSize: 12, color: '#6b7280'},
});

export default ManualChatDemoWrapper;

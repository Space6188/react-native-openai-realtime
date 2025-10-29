import React, {useEffect, useRef, useState} from 'react';
import {View, Text, Button, StyleSheet} from 'react-native';
import {
  RealtimeClientClass,
  attachChatAdapter,
  ErrorHandler,
  SuccessHandler,
} from 'react-native-openai-realtime';

export function AdvancedChat() {
  const clientRef = useRef<RealtimeClientClass | null>(null);
  const [status, setStatus] = useState('idle');
  const [chat, setChat] = useState<any[]>([]);

  useEffect(() => {
    // Обработчики
    const errorHandler = new ErrorHandler(event => {
      console.error('Error:', event);
    });

    const successHandler = new SuccessHandler({
      onPeerConnectionCreatingStarted: () => console.log('PC creating…'),
      onPeerConnectionCreated: pc => console.log('PC created', pc),
      onRTCPeerConnectionStateChange: setStatus,
      onGetUserMediaSetted: s => console.log('getUserMedia OK', s?.id),
      onLocalStreamSetted: s => console.log('Local stream', s?.id),
      onLocalStreamAddedTrack: t => console.log('Local track +', t.kind),
      onLocalStreamRemovedTrack: t => console.log('Local track -', t.kind),
      onRemoteStreamSetted: s => console.log('Remote stream', s?.id),
      onDataChannelOpen: dc => console.log('DC opened:', dc?.label),
      onDataChannelMessage: m => console.log('DC message:', m),
      onDataChannelClose: () => console.log('DC closed'),
      onIceGatheringComplete: () => console.log('ICE complete'),
      onIceGatheringTimeout: () => console.log('ICE timeout'),
      onIceGatheringStateChange: st => console.log('ICE state:', st),
      onMicrophonePermissionGranted: () => console.log('Mic granted'),
      onMicrophonePermissionDenied: () => console.log('Mic denied'),
      onHangUpStarted: () => console.log('Hangup started'),
      onHangUpDone: () => console.log('Hangup done'),
      onIOSTransceiverSetted: () => console.log('iOS transceiver set'),
    });

    // Клиент (direct)
    const client = new RealtimeClientClass(
      {
        // В проде замени на реальный провайдер эфемерного токена
        tokenProvider: async () => 'YOUR_EPHEMERAL_TOKEN',
        webrtc: {
          iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
        },
        session: {
          model: 'gpt-4o-realtime-preview-2024-12-17',
          voice: 'alloy',
        },
        hooks: {
          onOpen: dc => console.log('Connected!', dc?.label),
          onEvent: evt => console.log('Event:', evt?.type),
        },
        middleware: {
          incoming: [
            async ctx => {
              console.log('Incoming:', ctx.event?.type);
              return ctx.event;
            },
          ],
        },
        chat: {
          enabled: true,
          isMeaningfulText: t => t.trim().length > 0,
        },
      },
      successHandler,
      errorHandler,
    );

    clientRef.current = client;

    // Адаптер чата
    const detach = attachChatAdapter(client, setChat);

    // Статус соединения
    const unsubStatus = client.onConnectionStateChange(setStatus);

    // Подписки
    const unsubUser = client.on('user:delta', ({itemId, delta}) => {
      console.log('User delta:', itemId, delta);
    });

    return () => {
      try {
        detach();
        unsubStatus();
        unsubUser();
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

  const sendMessage = () => {
    clientRef.current?.sendResponse({
      instructions: 'Tell me a joke',
      modalities: ['text'],
    });
  };

  return (
    <View style={styles.container}>
      <Text>Status: {status}</Text>
      <Button title="Connect" onPress={connect} />
      <Button title="Send Message" onPress={sendMessage} />
      <Text>Chat messages: {chat.length}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
});

export default AdvancedChat;

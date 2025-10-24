import { useCallback, useEffect, useMemo, useRef, useState, FC } from 'react';
import type {
  RealtimeClientOptions,
  ChatMsg,
} from '@react-native-openai-realtime/types';
import { RealtimeClient } from '@react-native-openai-realtime/components/RealtimeClientClass';
import { attachChatAdapter } from '@react-native-openai-realtime/adapters/ChatAdapter';
import {
  RealtimeProvider,
  type RealtimeContextValue,
} from '@react-native-openai-realtime/context/RealtimeContext';
import type { RealTimeClientProps } from '@react-native-openai-realtime/types/RealtimeClient';
import { prune } from '@react-native-openai-realtime/helpers/prune';

export const RealTimeClient: FC<RealTimeClientProps> = ({
  tokenProvider,
  voice,
  webrtc,
  media,
  session,
  autoSessionUpdate,
  greetEnabled,
  greetInstructions,
  greetModalities,
  onOpen,
  onEvent,
  onError,
  onUserTranscriptionDelta,
  onUserTranscriptionCompleted,
  onAssistantTextDelta,
  onAssistantCompleted,
  onToolCall,
  incomingMiddleware,
  outgoingMiddleware,
  policyIsMeaningfulText,
  chatEnabled,
  chatIsMeaningfulText,
  logger,
  autoConnect = true,
  attachChat = true,
  children,
}) => {
  const clientRef = useRef<RealtimeClient | null>(null);
  const detachChatRef = useRef<null | (() => void)>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);

  // Собираем RealtimeClientOptions только из верхнеуровневых пропсов
  const clientOptions: RealtimeClientOptions = useMemo(() => {
    const topLevel: RealtimeClientOptions = prune({
      tokenProvider,
      voice,
      webrtc,
      media,
      session,
      autoSessionUpdate,
      greet:
        greetEnabled !== undefined || greetInstructions || greetModalities
          ? {
              enabled: greetEnabled ?? true,
              response: {
                instructions: greetInstructions,
                modalities: greetModalities,
              },
            }
          : undefined,
      hooks: prune({
        onOpen,
        onEvent,
        onError,
        onUserTranscriptionDelta,
        onUserTranscriptionCompleted,
        onAssistantTextDelta,
        onAssistantCompleted,
        onToolCall,
      }) as any,
      middleware: prune({
        incoming: incomingMiddleware,
        outgoing: outgoingMiddleware,
      }) as any,
      policy: prune({
        isMeaningfulText: policyIsMeaningfulText,
      }),
      chat: prune({
        enabled: chatEnabled,
        isMeaningfulText: chatIsMeaningfulText,
      }),
      logger,
    }) as RealtimeClientOptions;

    return topLevel;
  }, [
    tokenProvider,
    voice,
    webrtc,
    media,
    session,
    autoSessionUpdate,
    greetEnabled,
    greetInstructions,
    greetModalities,
    onOpen,
    onEvent,
    onError,
    onUserTranscriptionDelta,
    onUserTranscriptionCompleted,
    onAssistantTextDelta,
    onAssistantCompleted,
    onToolCall,
    incomingMiddleware,
    outgoingMiddleware,
    policyIsMeaningfulText,
    chatEnabled,
    chatIsMeaningfulText,
    logger,
  ]);

  const client = useMemo(() => {
    return new RealtimeClient(clientOptions);
  }, [clientOptions]);

  const connect = useCallback(async () => {
    try {
      setIsConnecting(true);
      clientRef.current = client;

      if (attachChat && !detachChatRef.current) {
        const isMeaningful =
          chatIsMeaningfulText ??
          policyIsMeaningfulText ??
          ((t: string) => !!t.trim());
        detachChatRef.current = attachChatAdapter(client, setChat, {
          isMeaningfulText: isMeaningful,
        });
      }

      client.on('assistant:response_started', () => setIsConnected(true));
      await client.connect();
      setIsConnected(true);
    } catch (e) {
      setIsConnected(false);
      throw e;
    } finally {
      setIsConnecting(false);
    }
  }, [client, attachChat, chatIsMeaningfulText, policyIsMeaningfulText]);

  const disconnect = async () => {
    try {
      if (clientRef.current) {
        await clientRef.current.disconnect();
      }
    } finally {
      if (detachChatRef.current) {
        detachChatRef.current();
        detachChatRef.current = null;
      }
      clientRef.current = null;
      setIsConnected(false);
      setChat([]);
    }
  };

  useEffect(() => {
    if (!autoConnect) return;
    connect().catch(() => {});
    return () => {
      disconnect().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value: RealtimeContextValue = useMemo(
    () => ({
      client,
      isConnected,
      isConnecting,
      chat,
      connect,
      disconnect,
      sendResponse: (opts?: any) => client.sendResponse(opts),
      sendResponseStrict: (opts: {
        instructions: string;
        modalities?: Array<'audio' | 'text'>;
        conversation?: 'default' | 'none';
      }) => client.sendResponseStrict(opts),
      updateSession: (patch: Partial<any>) => client.updateSession(patch),
      sendRaw: (e: any) => client.sendRaw(e),
    }),
    [client, isConnected, isConnecting, chat, connect]
  );

  const renderedChildren =
    typeof children === 'function' ? (children as any)(value) : children;

  return (
    <RealtimeProvider value={value}>
      {renderedChildren ?? null}
    </RealtimeProvider>
  );
};

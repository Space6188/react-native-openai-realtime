import {
  AddableMessage,
  ChatMsg,
  CoreConfig,
  ExtendedChatMsg,
  RealtimeClientOptionsBeforePrune,
  RealTimeClientProps,
  RealtimeContextValue,
} from '@react-native-openai-realtime/types';
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RealtimeClientClass } from './RealtimeClientClass';
import { attachChatAdapter } from '@react-native-openai-realtime/adapters';
import { RealtimeProvider } from '@react-native-openai-realtime/context';
import { prune } from '@react-native-openai-realtime/helpers';

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const RealTimeClient: FC<RealTimeClientProps> = ({
  tokenProvider,
  webrtc,
  media,
  chatInverted,
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
  chatUserAddOnDelta,
  chatUserPlaceholderOnStart,
  chatAssistantAddOnDelta,
  chatAssistantPlaceholderOnStart,
}) => {
  const clientRef = useRef<RealtimeClientClass | null>(null);
  const detachChatRef = useRef<null | (() => void)>(null);
  const connectionUnsubRef = useRef<(() => void) | null>(null);

  const [connectionState, setConnectionState] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  >('idle');

  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [addedMessages, setAddedMessages] = useState<ExtendedChatMsg[]>([]);

  const clientOptions: CoreConfig = useMemo(() => {
    const topLevel: CoreConfig = prune({
      tokenProvider,
      webrtc,
      media,
      chatInverted,
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
        userAddOnDelta: chatUserAddOnDelta,
        userPlaceholderOnStart: chatUserPlaceholderOnStart,
        assistantAddOnDelta: chatAssistantAddOnDelta,
        assistantPlaceholderOnStart: chatAssistantPlaceholderOnStart,
      }),
      logger,
    }) as CoreConfig;

    return topLevel;
  }, [
    tokenProvider,
    chatUserAddOnDelta,
    chatUserPlaceholderOnStart,
    chatAssistantAddOnDelta,
    chatAssistantPlaceholderOnStart,
    webrtc,
    media,
    chatInverted,
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
    return new RealtimeClientClass(
      clientOptions as RealtimeClientOptionsBeforePrune
    );
  }, [clientOptions]);

  // Подписка на connectionState из класса
  useEffect(() => {
    if (!client) return;

    setConnectionState(client.getConnectionState());

    const unsub = client.onConnectionStateChange((state) => {
      setConnectionState(state);
    });

    connectionUnsubRef.current = unsub;

    return () => {
      if (connectionUnsubRef.current) {
        connectionUnsubRef.current();
        connectionUnsubRef.current = null;
      }
    };
  }, [client]);

  const connect = useCallback(async () => {
    try {
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

      await client.connect();
    } catch (e) {
      throw e;
    }
  }, [client, attachChat, chatIsMeaningfulText, policyIsMeaningfulText]);

  const disconnect = useCallback(async () => {
    try {
      if (clientRef.current) {
        await clientRef.current.disconnect();
      }
    } finally {
      if (detachChatRef.current) {
        detachChatRef.current();
        detachChatRef.current = null;
      }
      if (connectionUnsubRef.current) {
        connectionUnsubRef.current();
        connectionUnsubRef.current = null;
      }
      clientRef.current = null;
      setChat([]);
      setAddedMessages([]);
    }
  }, []);

  useEffect(() => {
    if (!autoConnect) return;
    connect().catch(() => {});
    return () => {
      disconnect().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const normalize = useCallback((m: AddableMessage): ExtendedChatMsg => {
    const base = {
      id: m.id ?? makeId(),
      role: m.role ?? 'assistant',
      ts: m.ts ?? Date.now(),
    };

    if (
      (m as any).type === 'ui' ||
      ('kind' in (m as any) && 'payload' in (m as any))
    ) {
      return {
        ...base,
        type: 'ui',
        kind: (m as any).kind,
        payload: (m as any).payload,
      } as ExtendedChatMsg;
    }

    return {
      ...base,
      type: 'text',
      text: (m as any).text ?? '',
    } as unknown as ExtendedChatMsg;
  }, []);

  const addMessage = useCallback(
    (m: AddableMessage | AddableMessage[]) => {
      const arr = Array.isArray(m) ? m : [m];
      const normalized = arr.map(normalize);
      setAddedMessages((prev) => [...prev, ...normalized]);
      const ids = normalized.map((x) => (x as any).id as string);
      return Array.isArray(m) ? ids : ids[0];
    },
    [normalize]
  );

  const clearAdded = useCallback(() => setAddedMessages([]), []);

  const mergedChat = useMemo<ExtendedChatMsg[]>(() => {
    const merged = [...(chat ?? []), ...addedMessages];

    if (chatInverted) {
      return merged.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0));
    } else {
      return merged.sort((a: any, b: any) => (b.ts ?? 0) - (a.ts ?? 0));
    }
  }, [chat, addedMessages, chatInverted]);

  const value: RealtimeContextValue = useMemo(
    () => ({
      client,
      status: connectionState,
      chat: mergedChat,
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
      addMessage,
      clearAdded,
    }),
    [
      client,
      connectionState,
      mergedChat,
      connect,
      disconnect,
      addMessage,
      clearAdded,
    ]
  );

  const renderedChildren =
    typeof children === 'function' ? (children as any)(value) : children;

  return (
    <RealtimeProvider value={value}>
      {renderedChildren ?? null}
    </RealtimeProvider>
  );
};

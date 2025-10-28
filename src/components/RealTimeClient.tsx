import {
  AddableMessage,
  ChatMsg,
  CoreConfig,
  ExtendedChatMsg,
  RealtimeClientOptionsBeforePrune,
  RealTimeClientProps,
  RealtimeContextValue,
} from '@react-native-openai-realtime/types';
import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { RealtimeClientClass } from '@react-native-openai-realtime/components';
import { attachChatAdapter } from '@react-native-openai-realtime/adapters';
import { RealtimeProvider } from '@react-native-openai-realtime/context';
import { prune } from '@react-native-openai-realtime/helpers';

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const RealTimeClient: FC<RealTimeClientProps> = (props) => {
  const {
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
    autoConnect = false,
    attachChat = true,
    children,
    chatUserAddOnDelta,
    chatUserPlaceholderOnStart,
    chatAssistantAddOnDelta,
    chatAssistantPlaceholderOnStart,
  } = props;

  const clientRef = useRef<RealtimeClientClass | null>(null);
  const connectionUnsubRef = useRef<(() => void) | null>(null);
  const detachChatRef = useRef<null | (() => void)>(null);

  const [status, setStatus] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  >('idle');
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [addedMessages, setAddedMessages] = useState<ExtendedChatMsg[]>([]);

  // Snapshot опций (не создаёт клиента)
  const optionsSnapshot: CoreConfig = useMemo(() => {
    return prune({
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
      policy: prune({ isMeaningfulText: policyIsMeaningfulText }),
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
  }, [
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
    chatUserAddOnDelta,
    chatUserPlaceholderOnStart,
    chatAssistantAddOnDelta,
    chatAssistantPlaceholderOnStart,
  ]);

  // Создаём клиента лениво
  const ensureClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new RealtimeClientClass(
        optionsSnapshot as RealtimeClientOptionsBeforePrune
      );

      // Подписка на статус
      setStatus(clientRef.current.getConnectionState());
      const unsub = clientRef.current.onConnectionStateChange((s) =>
        setStatus(s)
      );
      connectionUnsubRef.current = unsub;

      // Прокинем tokenProvider, если обновится
      if (tokenProvider) {
        try {
          clientRef.current.setTokenProvider(tokenProvider);
        } catch {}
      }
    }
    return clientRef.current!;
  }, [optionsSnapshot, tokenProvider]);

  // Обновляем tokenProvider внутри уже созданного клиента
  useEffect(() => {
    if (clientRef.current && tokenProvider) {
      try {
        clientRef.current.setTokenProvider(tokenProvider);
      } catch {}
    }
  }, [tokenProvider]);

  // Разрываем соединение при уходе в фон
  useEffect(() => {
    const onAppState = (state: AppStateStatus) => {
      if (state === 'background' || state === 'inactive') {
        clientRef.current?.disconnect().catch(() => {});
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => sub.remove();
  }, []);

  const connect = useCallback(async () => {
    const client = ensureClient();
    try {
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
  }, [ensureClient, attachChat, chatIsMeaningfulText, policyIsMeaningfulText]);

  const disconnect = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await client.disconnect();
    } finally {
      if (detachChatRef.current) {
        detachChatRef.current();
        detachChatRef.current = null;
      }
      setChat([]);
      setAddedMessages([]);
    }
  }, []);

  // Автоконнект опционально
  useEffect(() => {
    if (!autoConnect) return;
    connect().catch(() => {});
    return () => {
      disconnect().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

  // Нормализация пользовательских UI-сообщений
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
    return chatInverted
      ? merged.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0))
      : merged.sort((a: any, b: any) => (b.ts ?? 0) - (a.ts ?? 0));
  }, [chat, addedMessages, chatInverted]);

  // ВАЖНО: провайдер всегда рендерится — без if (!client) return null
  const value: RealtimeContextValue = useMemo(
    () => ({
      client: clientRef.current,
      status,
      chat: mergedChat,
      connect,
      disconnect,
      sendResponse: (opts?: any) => clientRef.current?.sendResponse(opts),
      sendResponseStrict: (opts: {
        instructions: string;
        modalities?: Array<'audio' | 'text'>;
        conversation?: 'default' | 'none';
      }) => clientRef.current?.sendResponseStrict(opts),
      updateSession: (patch: Partial<any>) =>
        clientRef.current?.updateSession(patch),
      sendRaw: (e: any) => clientRef.current?.sendRaw(e),
      addMessage,
      clearAdded,
    }),
    [status, mergedChat, connect, disconnect, addMessage, clearAdded]
  );

  const renderedChildren =
    typeof children === 'function' ? (children as any)(value) : children;

  return (
    <RealtimeProvider value={value}>
      {renderedChildren ?? null}
    </RealtimeProvider>
  );
};

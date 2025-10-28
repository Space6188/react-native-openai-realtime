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
import { RealtimeClient } from './RealtimeClientClass';
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
  const clientRef = useRef<RealtimeClient | null>(null);
  const detachChatRef = useRef<null | (() => void)>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Базовый чат из встроенного ChatStore
  const [chat, setChat] = useState<ChatMsg[]>([]);

  // NEW: локальные добавленные сообщения (UI и др.)
  const [addedMessages, setAddedMessages] = useState<ExtendedChatMsg[]>([]);

  // Собираем RealtimeClientOptions только из верхнеуровневых пропсов
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
    return new RealtimeClient(
      clientOptions as RealtimeClientOptionsBeforePrune
    );
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
      setAddedMessages([]); // NEW: очищаем локальные сообщения при дисконнекте
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

  // NEW: нормализация входящих addMessage
  const normalize = useCallback((m: AddableMessage): ExtendedChatMsg => {
    const base = {
      id: m.id ?? makeId(),
      role: m.role ?? 'assistant',
      ts: m.ts ?? Date.now(),
    };

    // UI-сообщение
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

    // Текстовое сообщение (по умолчанию)
    return {
      ...base,
      type: 'text',
      text: (m as any).text ?? '',
    } as unknown as ExtendedChatMsg;
  }, []);

  // NEW: публичные методы
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
    // Объединяем два массива сообщений
    const merged = [...(chat ?? []), ...addedMessages];

    if (chatInverted) {
      // Для FlatList inverted={true}, новые элементы должны быть в конце.
      // Сортировка по возрастанию `ts` гарантирует, что старые сообщения будут в начале, а новые - в конце.
      // FlatList сам перевернет порядок отображения.
      return merged.sort((a: any, b: any) => (a.ts ?? 0) - (b.ts ?? 0));
    } else {
      // Для обычного FlatList, новые элементы должны быть в начале.
      // Сортируем по убыванию `ts`.
      return merged.sort((a: any, b: any) => (b.ts ?? 0) - (a.ts ?? 0));
    }
  }, [chat, addedMessages, chatInverted]);

  const value: RealtimeContextValue = useMemo(
    () => ({
      client,
      isConnected,
      isConnecting,
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

      // NEW:
      addMessage,
      clearAdded,
    }),
    [
      client,
      isConnected,
      isConnecting,
      mergedChat,
      connect,
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

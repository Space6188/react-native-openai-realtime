import React, { useCallback, useMemo, useRef } from 'react';
import {
  RealTimeClient,
  createSpeechActivityMiddleware,
  type IncomingMiddleware,
  type OutgoingMiddleware,
  type RealTimeClientHandle,
} from 'react-native-openai-realtime';
import {
  TOOL_ACK_MESSAGES,
  WORKSPACE_INSTRUCTIONS,
  WORKSPACE_TOOLS,
  type WorkspaceToolName,
} from './workspaceScenario';

const SERVER_BASE = 'http://localhost:8787';

const tokenProvider = async () => {
  const response = await fetch(`${SERVER_BASE}/realtime/session`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch token: ${response.status} ${text}`);
  }
  const json = await response.json();
  return json.client_secret.value;
};

const createIncomingMiddleware = (): IncomingMiddleware[] => [
  createSpeechActivityMiddleware(),
  async ({ event }) => {
    if (event?.type === 'conversation.item.input_audio_transcription.delta') {
      const delta = event?.delta?.trim() || '';
      if (/^(эм+|мм+|ээ+|ага+|угу+|хм+).?$/i.test(delta)) {
        console.log('🚫 Filtered filler:', delta);
        return 'stop';
      }
    }
    if (
      event?.type === 'response.text.delta' ||
      event?.type === 'response.audio_transcript.delta'
    ) {
      if (!event?.delta?.trim()) {
        return 'stop';
      }
    }
    return;
  },
  async ({ event }) => {
    const important = new Set([
      'conversation.item.created',
      'response.created',
      'response.done',
      'error',
    ]);
    if (important.has(event?.type)) {
      console.log('📨', event.type);
    }
    return;
  },
];

const createOutgoingMiddleware = (): OutgoingMiddleware[] => [
  event => {
    if (
      event?.type === 'conversation.item.create' &&
      event.item?.content?.[0]?.type === 'input_text'
    ) {
      const text = (event.item.content[0].text || '').trim();
      if (!text) {
        console.warn('⚠️ Blocked empty text message');
        return 'stop';
      }
      event.item.content[0].text = text;
    }
    return event;
  },
  event => {
    if (event?.type === 'response.create') {
      const instructions = event.response?.instructions || '';
      if (instructions && !instructions.includes('[Atlas]')) {
        return {
          ...event,
          response: {
            ...event.response,
            instructions: `[Atlas] ${instructions}`,
          },
        };
      }
    }
    return event;
  },
];

const LOADING_BUBBLES: Record<WorkspaceToolName, string> = {
  list_workspaces:
    '🔄 Searching the workspace catalog so you can compare without digging.',
  calculate_workspace_quote:
    '🔄 Calculating the quote with staffing and equipment.',
  create_workspace_booking:
    '🔄 Finalising the reservation details with the onsite team.',
  list_last_minute_offers:
    '🔄 Checking which last-minute slots are still open.',
};

const MOCK_SPACES = [
  {
    id: 'studio-soho',
    name: 'Soho Workshop Loft',
    city: 'New York',
    capacity: 18,
    layout: ['workshop', 'boardroom'],
    amenities: ['whiteboard', 'projector', 'studio lighting'],
  },
  {
    id: 'studio-shoreditch',
    name: 'Shoreditch Creator Lab',
    city: 'London',
    capacity: 12,
    layout: ['boardroom', 'podcast'],
    amenities: ['4K camera kit', 'podcast mics', 'backdrops'],
  },
  {
    id: 'studio-mitte',
    name: 'Mitte Innovation Hub',
    city: 'Berlin',
    capacity: 24,
    layout: ['workshop', 'hackathon'],
    amenities: ['ultra-wide displays', 'whiteboard wall', 'sound system'],
  },
];

const MOCK_DEALS = [
  {
    id: 'deal-nyc',
    city: 'New York',
    label: 'Sunrise Sprint Slot',
    starts_at: '2025-01-12T08:30:00-05:00',
    discount: 25,
  },
  {
    id: 'deal-ldn',
    city: 'London',
    label: 'Evening Creator Special',
    starts_at: '2025-01-11T18:00:00Z',
    discount: 30,
  },
  {
    id: 'deal-berlin',
    city: 'Berlin',
    label: 'Night Owl Hack Pack',
    starts_at: '2025-01-10T22:00:00+01:00',
    discount: 20,
  },
];

const buildWorkspaceQuote = (args: any) => {
  const base = 120;
  const durationHours =
    (new Date(args.end_time).getTime() - new Date(args.start_time).getTime()) /
    3_600_000;
  const capacityCost = Math.max(args.capacity ?? 1, 1) * 9;
  const layoutCost =
    args.layout === 'workshop'
      ? 65
      : args.layout === 'boardroom'
      ? 40
      : args.layout === 'hackathon'
      ? 85
      : 30;
  const equipmentCost = Array.isArray(args.equipment)
    ? args.equipment.length * 15
    : 0;
  const cateringCost = args.catering ? 90 : 0;
  const durationCost = Number.isFinite(durationHours)
    ? Math.max(durationHours, 1) * 50
    : 50;

  const subtotal = Math.round(base + capacityCost + layoutCost + equipmentCost);
  const total = subtotal + cateringCost + durationCost;

  return {
    quote_id: `quote-${Date.now()}`,
    city: args.city,
    layout: args.layout,
    capacity: args.capacity,
    start_time: args.start_time,
    end_time: args.end_time,
    equipment: args.equipment ?? [],
    catering: Boolean(args.catering),
    subtotal: total,
    taxes: Math.round(total * 0.08),
    currency: 'USD',
  };
};

export const GlobalRealtimeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const rtcRef = useRef<RealTimeClientHandle | null>(null);
  const incomingMiddleware = useMemo(() => createIncomingMiddleware(), []);
  const outgoingMiddleware = useMemo(() => createOutgoingMiddleware(), []);

  const onOpen = useCallback((dc: RTCDataChannel) => {
    console.log('🎉 DataChannel opened:', dc?.label);
  }, []);

  const onError = useCallback((errorEvent: any) => {
    if (errorEvent?.stage) {
      console.error(
        `❌ Error at ${errorEvent.stage}:`,
        errorEvent.error?.message || errorEvent.error,
      );
      console.error('Severity:', errorEvent.severity);
      console.error('Recoverable:', errorEvent.recoverable);
      if (errorEvent.context) {
        console.error('Context:', errorEvent.context);
      }
    } else {
      console.error('❌ Server error:', errorEvent);
    }
  }, []);

  const onEvent = useCallback((event: any) => {
    if (
      event?.type === 'response.function_call_arguments.done' &&
      event?.name &&
      TOOL_ACK_MESSAGES[event.name as WorkspaceToolName]
    ) {
      const bubble = LOADING_BUBBLES[event.name as WorkspaceToolName];
      if (bubble) {
        rtcRef.current?.addMessage({
          type: 'ui',
          role: 'assistant',
          kind: 'loader',
          payload: { text: bubble },
        });
      }
    }
  }, []);

  const onToolCall = useCallback(
    async ({
      name,
      args,
      call_id,
    }: {
      name: WorkspaceToolName;
      args: any;
      call_id: string;
    }) => {
      await new Promise(resolve => setTimeout(resolve, 350));
      try {
        if (name === 'list_workspaces') {
          const city = (args?.city || '').toLowerCase();
          const needs = Array.isArray(args?.needs)
            ? (args.needs as string[])
            : [];
          const items = MOCK_SPACES.filter(space => {
            const cityMatch = city ? space.city.toLowerCase() === city : true;
            const needsMatch = needs.length
              ? needs.every(need =>
                  space.amenities.some(amenity =>
                    amenity.toLowerCase().includes(need.toLowerCase()),
                  ),
                )
              : true;
            return cityMatch && needsMatch;
          });

          rtcRef.current?.addMessage({
            type: 'ui',
            role: 'assistant',
            kind: 'workspace_list',
            payload: {
              requested_city: args?.city ?? 'Any',
              items,
            },
          });

          return { items };
        }

        if (name === 'calculate_workspace_quote') {
          const quote = buildWorkspaceQuote(args);
          rtcRef.current?.addMessage({
            type: 'ui',
            role: 'assistant',
            kind: 'workspace_quote',
            payload: quote,
          });
          return quote;
        }

        if (name === 'create_workspace_booking') {
          const confirmation = {
            booking_reference: `atlas-${Math.random().toString(36).slice(2, 8)}`,
            quote_id: args.quote_id,
            customer_name: args.customer_name,
            status: 'confirmed',
          };

          rtcRef.current?.addMessage({
            type: 'ui',
            role: 'assistant',
            kind: 'workspace_booking',
            payload: confirmation,
          });

          return confirmation;
        }

        if (name === 'list_last_minute_offers') {
          const city = (args?.city || '').toLowerCase();
          const items = MOCK_DEALS.filter(deal =>
            city ? deal.city.toLowerCase() === city : true,
          );

          rtcRef.current?.addMessage({
            type: 'ui',
            role: 'assistant',
            kind: 'workspace_deals',
            payload: {
              requested_city: args?.city ?? 'Any',
              items,
            },
          });

          return { items };
        }

        return undefined;
      } catch (error: any) {
        console.error('❌ Tool call failed:', error);
        rtcRef.current?.addMessage({
          type: 'ui',
          role: 'assistant',
          kind: 'error',
          payload: { error: error?.message || String(error) },
        });
        return { error: error?.message || String(error) };
      } finally {
        rtcRef.current?.clearAdded?.();
      }
    },
    [],
  );

  const logger = useMemo(
    () => ({
      info: (message: string, ...rest: any[]) => console.log('ℹ️', message, ...rest),
      warn: (message: string, ...rest: any[]) => console.warn('⚠️', message, ...rest),
      error: (message: string, ...rest: any[]) => console.error('❌', message, ...rest),
      debug: (message: string, ...rest: any[]) => {
        if (__DEV__) console.log('🐛', message, ...rest);
      },
    }),
    [],
  );

  return (
    <RealTimeClient
      ref={rtcRef}
      tokenProvider={tokenProvider}
      session={{
        model: 'gpt-4o-realtime-preview-2024-12-17',
        voice: 'shimmer',
        modalities: ['audio', 'text'],
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.55,
          prefix_padding_ms: 250,
          silence_duration_ms: 1000,
        },
        tools: WORKSPACE_TOOLS,
        instructions: WORKSPACE_INSTRUCTIONS,
      }}
      initializeMode={{ type: 'text' }}
      greetEnabled={false}
      autoConnect={true}
      autoSessionUpdate={true}
      allowConnectWithoutMic={true}
      onOpen={onOpen}
      onError={onError}
      onEvent={onEvent}
      onToolCall={onToolCall}
      onSuccess={stage => {
        if (stage === 'data_channel_open') {
          console.log('✅ Data channel ready');
        }
      }}
      onPeerConnectionCreated={() => console.log('✅ PeerConnection created')}
      onRTCPeerConnectionStateChange={state =>
        console.log('🔄 Connection state:', state)
      }
      onDataChannelOpen={dc => console.log('✅ DataChannel opened:', dc.label)}
      onIceGatheringComplete={() => console.log('✅ ICE gathering complete')}
      onMicrophonePermissionDenied={() =>
        console.warn('⚠️ Microphone permission denied; using recvonly')
      }
      incomingMiddleware={incomingMiddleware}
      outgoingMiddleware={outgoingMiddleware}
      policyIsMeaningfulText={text => text.trim().length >= 2}
      chatEnabled={true}
      chatIsMeaningfulText={text => !!text.trim()}
      chatUserAddOnDelta={true}
      chatAssistantAddOnDelta={true}
      chatInverted={false}
      deleteChatHistoryOnDisconnect={false}
      logger={logger}
    >
      {children}
    </RealTimeClient>
  );
};

export default GlobalRealtimeProvider;

// hooks/useSessionOptions.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import InCallManager from 'react-native-incall-manager';
import { RealtimeClientClass } from '@react-native-openai-realtime/components';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useSessionOptions = (client: RealtimeClientClass) => {
  const clientRef = useRef<RealtimeClientClass>(client);
  const lastResponseIdRef = useRef<string | null>(null);
  const [mode, setMode] = useState<'text' | 'voice'>('text');
  const [isModeReady, setIsModeReady] = useState<
    'idle' | 'connecting' | 'connected' | 'disconnected'
  >('idle');

  useEffect(() => {
    clientRef.current = client;
  }, [client]);

  useEffect(() => {
    // const unsubscribe = subscribeToAssistantEvents(() => restartSpeakerRoute());
    setMicrophoneEnabled(false);
    const unsubscribe = subscribeToAssistantEvents();
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const waitUntilDataChannelOpen = useCallback(async (timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const dc = clientRef.current?.getDataChannel?.();
        if (dc && dc.readyState === 'open') {
          return true;
        }
      } catch {}
      await delay(100);
    }
    return false;
  }, []);

  const setRemoteTracksEnabled = useCallback((enabled: boolean) => {
    try {
      const remote = clientRef.current?.getRemoteStream?.();
      if (remote && typeof remote.getAudioTracks === 'function') {
        remote.getAudioTracks().forEach((t: any) => {
          t.enabled = enabled;
        });
      }
    } catch (e) {
      console.warn('⚠️ setRemoteTracksEnabled failed:', e);
    }
  }, []);

  const setMicrophoneEnabled = useCallback((enabled: boolean) => {
    try {
      // Убедитесь, что clientRef.current и getLocalStream() существуют
      const clientRefCurrent = clientRef.current;
      if (
        !clientRefCurrent ||
        typeof clientRefCurrent.getLocalStream !== 'function'
      ) {
        return;
      }

      const localStream = clientRefCurrent.getLocalStream?.();
      if (localStream) {
        console.log('🎤 localStream:', localStream);
        localStream.getAudioTracks().forEach((track: any) => {
          // Устанавливаем свойство enabled
          track.enabled = enabled;
          console.log(
            `🎤 Microphone track ${enabled ? 'enabled' : 'disabled'}`
          );
        });
      }
    } catch (e) {
      console.warn('⚠️ setMicrophoneEnabled failed:', e);
    }
  }, []);

  const restartSpeakerRoute = useCallback(async () => {
    try {
      InCallManager.start({ media: 'audio', auto: false, ringback: '' });
      InCallManager.setSpeakerphoneOn(true);
      InCallManager.setForceSpeakerphoneOn(true);
    } catch (e) {
      console.warn('⚠️ restartSpeakerRoute failed:', e);
    }
  }, []);

  const subscribeToAssistantEvents = useCallback(
    (onAssistantStarted?: () => void) => {
      if (!clientRef.current?.on) return () => {};

      const off1 = clientRef.current.on(
        'assistant:response_started',
        ({ responseId }: any) => {
          lastResponseIdRef.current = responseId;
          // setRemoteTracksEnabled(true);
          onAssistantStarted?.();
          console.log('🎤 Assistant started:', responseId);
        }
      );

      const off2 = clientRef.current.on(
        'assistant:completed',
        ({ responseId }: any) => {
          if (lastResponseIdRef.current === responseId) {
            lastResponseIdRef.current = null;
            console.log('✅ Assistant completed:', responseId);
          }
        }
      );

      return () => {
        try {
          off1?.();
          off2?.();
        } catch {}
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setRemoteTracksEnabled]
  );

  const cancelAssistantNow = useCallback(
    async (onComplete?: () => void, onFail?: (err: any) => void) => {
      try {
        const chan = (clientRef.current as any)?.getDataChannel?.();
        if (!chan || chan.readyState !== 'open') return;

        const rid = lastResponseIdRef.current ?? undefined;

        InCallManager.stop();
        await (clientRef.current as any)?.sendRaw({
          type: 'response.cancel',
          ...(rid ? { response_id: rid } : {}),
        });
        await (clientRef.current as any)?.sendRaw({
          type: 'output_audio_buffer.clear',
        });
        setRemoteTracksEnabled(false);
        setMicrophoneEnabled(false);
        await delay(120);
        onComplete?.();
      } catch (e) {
        onFail?.(e);
      }
    },

    [setRemoteTracksEnabled, setMicrophoneEnabled]
  );

  const enforceTextSession = useCallback(async () => {
    try {
      setRemoteTracksEnabled(false);
      setMicrophoneEnabled(false);
      await cancelAssistantNow();
      await clientRef.current?.sendRaw({
        type: 'session.update',
        session: {
          model: 'gpt-4o-realtime-preview-2024-12-17',
          voice: 'shimmer',
          modalities: ['text'],
          turn_detection: null,
          input_audio_transcription: null,
        },
      });
      InCallManager.stop();
    } catch {
      throw new Error('Failed to enforce text session');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setRemoteTracksEnabled]);

  const enforceVoiceSession = useCallback(async () => {
    try {
      await (clientRef.current as any)?.sendRaw({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          turn_detection: {
            type: 'server_vad',
            threshold: 0.7,
            prefix_padding_ms: 500,
            silence_duration_ms: 1200,
          },
          input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
        },
      });
      setMicrophoneEnabled(true);
      setRemoteTracksEnabled(true);
      await restartSpeakerRoute();
    } catch {
      throw new Error('Failed to enforce voice session');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setRemoteTracksEnabled]);

  const initSession = async (newMode: 'text' | 'voice') => {
    setIsModeReady('connecting');
    const dcOpened = await waitUntilDataChannelOpen(5000);
    if (!dcOpened) {
      throw new Error('DataChannel not open');
    }
    try {
      if (newMode === 'text') {
        await enforceTextSession();
        setIsModeReady('connected');
      } else {
        await enforceVoiceSession();
        setIsModeReady('connected');
      }
      setMode(newMode);
    } catch {
      setIsModeReady('disconnected');
      throw new Error('Failed to init session');
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) {
      console.warn('⚠️ Empty message');
      throw new Error('Empty message');
    }

    const dc = clientRef.current?.getDataChannel?.();
    if (!dc || dc.readyState !== 'open') {
      console.warn('⚠️ DataChannel not open');
      throw new Error('DataChannel not open');
    }

    try {
      await clientRef.current?.sendRaw({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      });

      await clientRef.current?.sendRaw({
        type: 'response.create',
        response: {
          modalities: ['text'],
          instructions: 'Ответь кратко и по делу.',
        },
      });

      console.log('✅ Message sent');
    } catch {
      throw new Error('Failed to send message');
    }
  };

  return {
    subscribeToAssistantEvents,
    handleSendMessage,
    initSession,
    isModeReady,
    mode,
  };
};

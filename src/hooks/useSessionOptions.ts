// hooks/useSessionOptions.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import InCallManager from 'react-native-incall-manager';
import { RealtimeClientClass } from 'react-native-openai-realtime';

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
    const unsubscribe = subscribeToAssistantEvents(() => restartSpeakerRoute());
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
      const clientRefCurrent = clientRef.current;
      if (
        !clientRefCurrent ||
        typeof clientRefCurrent.getLocalStream !== 'function'
      ) {
        console.warn('⚠️ Client or getLocalStream not available');
        return;
      }

      const localStream = clientRefCurrent.getLocalStream?.();
      if (localStream) {
        console.log('🎤 localStream:', localStream);
        localStream.getAudioTracks().forEach((track: any) => {
          track.enabled = enabled;
          console.log(
            `🎤 Microphone track ${enabled ? 'enabled' : 'disabled'}`
          );
        });
      } else {
        console.warn('⚠️ No local stream available');
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
          setRemoteTracksEnabled(true);
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
      console.log('📝 Switching to TEXT mode...');

      await cancelAssistantNow();

      // 2. Отключаем треки
      setRemoteTracksEnabled(false);
      setMicrophoneEnabled(false);

      // 3. Останавливаем InCallManager
      InCallManager.stop();

      // 4. Обновляем сессию на текстовый режим
      await clientRef.current?.sendRaw({
        type: 'session.update',
        session: {
          modalities: ['text'],
          turn_detection: null,
          input_audio_transcription: null,
        },
      });

      console.log('✅ TEXT mode activated');
    } catch (e) {
      console.error('❌ Failed to enforce text session:', e);
      throw new Error('Failed to enforce text session');
    }
  }, [cancelAssistantNow, setRemoteTracksEnabled, setMicrophoneEnabled]);

  const enforceVoiceSession = useCallback(async () => {
    try {
      console.log('🎤 Switching to VOICE mode...');

      await clientRef.current?.sendRaw({
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          turn_detection: {
            type: 'server_vad',
            threshold: 0.7,
            prefix_padding_ms: 500,
            silence_duration_ms: 1200,
          },
          input_audio_transcription: {
            model: 'whisper-1',
          },
        },
      });

      console.log('✅ Session updated to voice mode');

      // 2. Ждем немного, чтобы сервер применил изменения
      await delay(300);

      // 3. Запускаем speaker route
      await restartSpeakerRoute();

      // 4. Включаем треки
      setRemoteTracksEnabled(true);
      setMicrophoneEnabled(true);
      // 5. Проверяем, что микрофон действительно включен
      const localStream = clientRef.current?.getLocalStream?.();
      if (localStream) {
        const tracks = localStream.getAudioTracks();
        console.log(
          '🎤 Audio tracks after enable:',
          tracks.map((t: any) => ({
            id: t.id,
            enabled: t.enabled,
            readyState: t.readyState,
          }))
        );
      } else {
        console.warn('⚠️ No local stream found after voice session setup');
      }

      console.log('✅ VOICE mode activated');
    } catch (e) {
      console.error('❌ Failed to enforce voice session:', e);
      throw new Error('Failed to enforce voice session');
    }
  }, [restartSpeakerRoute, setRemoteTracksEnabled, setMicrophoneEnabled]);

  const initSession = useCallback(
    async (newMode: 'text' | 'voice') => {
      console.log(`🔄 Initializing session in ${newMode} mode...`);
      setIsModeReady('connecting');

      const dcOpened = await waitUntilDataChannelOpen(5000);
      if (!dcOpened) {
        setIsModeReady('disconnected');
        throw new Error('DataChannel not open');
      }

      try {
        if (newMode === 'text') {
          await enforceTextSession();
        } else {
          await enforceVoiceSession();
        }

        setMode(newMode);
        setIsModeReady('connected');
        console.log(`✅ Session initialized in ${newMode} mode`);
      } catch (e) {
        console.error('❌ Failed to init session:', e);
        setIsModeReady('disconnected');
        throw new Error('Failed to init session');
      }
    },
    [waitUntilDataChannelOpen, enforceTextSession, enforceVoiceSession]
  );

  const handleSendMessage = useCallback(async (text: string) => {
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
        },
      });

      console.log('✅ Message sent');
    } catch (e) {
      console.error('❌ Failed to send message:', e);
      throw new Error('Failed to send message');
    }
  }, []);

  return {
    subscribeToAssistantEvents,
    handleSendMessage,
    initSession,
    isModeReady,
    mode,
    cancelAssistantNow,
  };
};

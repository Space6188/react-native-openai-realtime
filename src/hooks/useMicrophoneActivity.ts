import { useEffect, useRef, useState } from 'react';
import { useRealtime } from '@react-native-openai-realtime/hooks';
import type { RealtimeClientClass } from '@react-native-openai-realtime/components';

type Mode = 'server' | 'stats' | 'auto';

export type UseMicrophoneActivityOptions = {
  client?: RealtimeClientClass | null;
  mode?: Mode;
  silenceMs?: number;
  levelThreshold?: number;
  pollInterval?: number;
};

export function useMicrophoneActivity(opts?: UseMicrophoneActivityOptions) {
  const { client: ctxClient } = useRealtime();
  const client = opts?.client ?? (ctxClient as RealtimeClientClass | null);
  const [isMicActive, setIsMicActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [remoteLevel, setRemoteLevel] = useState(0); // уровень собеседника
  const [isCapturing, setIsCapturing] = useState(false);

  const lastHeardRef = useRef<number>(0);
  const silenceMs = opts?.silenceMs ?? 600;
  const threshold = opts?.levelThreshold ?? 0.02;
  const pollInterval = opts?.pollInterval ?? 250;
  const mode = opts?.mode ?? 'auto';

  useEffect(() => {
    if (!client) return;

    let unsubDelta: (() => void) | null = null;
    let unsubCompleted: (() => void) | null = null;
    let silenceTimer: any = null;

    const enableServer = mode === 'server' || mode === 'auto';
    if (enableServer) {
      unsubDelta = client.on('user:delta', () => {
        lastHeardRef.current = Date.now();
        setIsMicActive(true);
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (Date.now() - lastHeardRef.current >= silenceMs) {
            setIsMicActive(false);
          }
        }, silenceMs + 20);
      });
      unsubCompleted = client.on('user:completed', () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => setIsMicActive(false), silenceMs / 2);
      });
    }

    let poll: any = null;
    const enableStats = mode !== 'server';
    if (enableStats) {
      poll = setInterval(async () => {
        try {
          const pc = client.getPeerConnection?.();
          if (!pc) return;

          // Проверка захвата аудио
          const localStream = client.getLocalStream?.();
          const capturing =
            !!localStream &&
            typeof localStream.getAudioTracks === 'function' &&
            localStream
              .getAudioTracks()
              .some((t: any) => t.enabled && t.readyState === 'live');
          setIsCapturing(capturing);

          // Уровень исходящего аудио (микрофон)
          if (pc.getSenders) {
            const senders = pc.getSenders();
            const audioSender = senders.find(
              (s: any) => s.track && s.track.kind === 'audio'
            );
            if (audioSender && audioSender.getStats) {
              const stats = await audioSender.getStats();
              const lvl = extractAudioLevel(stats);
              setLevel(lvl);

              if (mode === 'stats') {
                setIsMicActive(lvl > threshold);
              }
              if (mode === 'auto') {
                if (Date.now() - lastHeardRef.current > 2 * silenceMs) {
                  setIsMicActive(lvl > threshold);
                }
              }
            }
          }

          // Уровень входящего аудио (собеседник)
          if (pc.getReceivers) {
            const receivers = pc.getReceivers();
            const audioReceiver = receivers.find(
              (r: any) => r.track && r.track.kind === 'audio'
            );
            if (audioReceiver && audioReceiver.getStats) {
              const stats = await audioReceiver.getStats();
              const lvl = extractAudioLevel(stats);
              setRemoteLevel(lvl);
            }
          }
        } catch {
          // no-op
        }
      }, pollInterval);
    } else {
      const local = client.getLocalStream?.();
      const capturing =
        !!local &&
        typeof local.getAudioTracks === 'function' &&
        local
          .getAudioTracks()
          .some((t: any) => t.enabled && t.readyState === 'live');
      setIsCapturing(capturing);
    }

    return () => {
      if (unsubDelta) unsubDelta();
      if (unsubCompleted) unsubCompleted();
      if (silenceTimer) clearTimeout(silenceTimer);
      if (poll) clearInterval(poll);
    };
  }, [client, mode, silenceMs, threshold, pollInterval]);

  return { isMicActive, level, remoteLevel, isCapturing };
}

// Вспомогательная функция для извлечения уровня из статистики
function extractAudioLevel(stats: RTCStatsReport): number {
  let lvl = 0;
  stats.forEach((r: any) => {
    // Уровень аудио в media-source или track
    if (r.type === 'media-source' && typeof r.audioLevel === 'number') {
      lvl = Math.max(lvl, r.audioLevel);
    }
    if (r.type === 'track' && typeof r.audioLevel === 'number') {
      lvl = Math.max(lvl, r.audioLevel);
    }
    // Энергия аудио
    if (
      typeof r.totalAudioEnergy === 'number' &&
      typeof r.totalSamplesDuration === 'number' &&
      r.totalSamplesDuration > 0
    ) {
      const energy = r.totalAudioEnergy / r.totalSamplesDuration;
      lvl = Math.max(lvl, Math.min(1, Math.sqrt(energy)));
    }
    // Старые реализации
    if (typeof r.audioInputLevel === 'number') {
      lvl = Math.max(lvl, Math.min(1, r.audioInputLevel / 32767));
    }
    // Для входящего аудио может быть audioOutputLevel
    if (typeof r.audioOutputLevel === 'number') {
      lvl = Math.max(lvl, Math.min(1, r.audioOutputLevel / 32767));
    }
  });
  return lvl;
}

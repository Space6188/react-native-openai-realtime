import { useEffect, useRef, useState } from 'react';
import { useRealtime } from '@react-native-openai-realtime/hooks';
import type { RealtimeClientClass } from '@react-native-openai-realtime/components';

type Mode = 'server' | 'stats' | 'auto';

export type UseMicrophoneActivityOptions = {
  client?: RealtimeClientClass | null;
  mode?: Mode; // default: 'auto'
  silenceMs?: number; // таймаут без "дельт", после которого считаем тишину (по server-событиям)
  levelThreshold?: number; // порог срабатывания для stats-режима
  pollInterval?: number; // период опроса getStats
};

export function useMicrophoneActivity(opts?: UseMicrophoneActivityOptions) {
  const { client: ctxClient } = useRealtime();
  const client = opts?.client ?? (ctxClient as RealtimeClientClass | null);
  const [isMicActive, setIsMicActive] = useState(false);
  const [level, setLevel] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);

  const lastHeardRef = useRef<number>(0);
  const silenceMs = opts?.silenceMs ?? 600;
  const threshold = opts?.levelThreshold ?? 0.02;
  const pollInterval = opts?.pollInterval ?? 250;
  const mode = opts?.mode ?? 'auto';

  useEffect(() => {
    if (!client) return;

    // server-mode: активируем активность на дельты пользователя
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

    // stats-mode: опрашиваем audioLevel локального sender'а
    let poll: any = null;
    const enableStats = mode !== 'server'; // stats | auto
    if (enableStats) {
      poll = setInterval(async () => {
        try {
          const pc = client.getPeerConnection?.();
          if (!pc || !pc.getSenders) return;
          const senders = pc.getSenders();
          const audioSender = senders.find(
            (s: any) => s.track && s.track.kind === 'audio'
          );
          if (!audioSender || !audioSender.getStats) return;

          // заодно проверим "идёт ли захват"
          const localStream = client.getLocalStream?.();
          const capturing =
            !!localStream &&
            typeof localStream.getAudioTracks === 'function' &&
            localStream
              .getAudioTracks()
              .some((t: any) => t.enabled && t.readyState === 'live');
          setIsCapturing(capturing);

          const stats = await audioSender.getStats();
          let lvl = 0;
          stats.forEach((r: any) => {
            if (r.type === 'media-source' && typeof r.audioLevel === 'number') {
              lvl = Math.max(lvl, r.audioLevel);
            }
            if (r.type === 'track' && typeof r.audioLevel === 'number') {
              lvl = Math.max(lvl, r.audioLevel);
            }
            if (
              typeof r.totalAudioEnergy === 'number' &&
              typeof r.totalSamplesDuration === 'number' &&
              r.totalSamplesDuration > 0
            ) {
              const energy = r.totalAudioEnergy / r.totalSamplesDuration;
              lvl = Math.max(lvl, Math.min(1, Math.sqrt(energy)));
            }
            if (typeof r.audioInputLevel === 'number') {
              // старые реализации: 0..32767
              lvl = Math.max(lvl, Math.min(1, r.audioInputLevel / 32767));
            }
          });
          setLevel(lvl);

          if (mode === 'stats') {
            setIsMicActive(lvl > threshold);
          }
          if (mode === 'auto') {
            // если не было server-дэлт давно — ориентируемся на stats
            if (Date.now() - lastHeardRef.current > 2 * silenceMs) {
              setIsMicActive(lvl > threshold);
            }
          }
        } catch {
          // no-op
        }
      }, pollInterval);
    } else {
      // хотя бы проверим isCapturing
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

  return { isMicActive, level, isCapturing };
}

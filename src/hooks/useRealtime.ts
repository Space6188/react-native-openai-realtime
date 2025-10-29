import { RealtimeContext } from '@react-native-openai-realtime/context';
import { useContext } from 'react';
import type { RealtimeContextValue } from '@react-native-openai-realtime/types';

export function useRealtime(): RealtimeContextValue {
  // ✅ Получаем контекст
  const context = useContext(RealtimeContext);

  // ✅ Проверяем, что контекст существует
  if (!context) {
    throw new Error('useRealtime must be used within a RealtimeProvider');
  }

  return context;
}

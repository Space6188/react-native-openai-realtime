import { RealtimeContext } from '@react-native-openai-realtime/context';
import { useContext } from 'react';

export function useRealtime() {
  return useContext(RealtimeContext);
}

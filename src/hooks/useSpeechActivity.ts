import {
  speechActivityStore,
  SpeechActivityStoreType,
} from '@react-native-openai-realtime/middlewares';
import { useEffect, useState } from 'react';
import type { SpeechActivityState } from '@react-native-openai-realtime/types';

export function useSpeechActivity(
  store = speechActivityStore as SpeechActivityStoreType
) {
  const [state, setState] = useState<SpeechActivityState>(() => store.get());
  useEffect(() => store.subscribe(setState) as any, [store]);
  return state;
}

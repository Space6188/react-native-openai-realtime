import type { RealtimeClientOptionsBeforePrune } from '@react-native-openai-realtime/types';
import { deepMerge } from '@react-native-openai-realtime/helpers';
import { DEFAULTS } from '@react-native-openai-realtime/constants';

export function applyDefaults(
  user: RealtimeClientOptionsBeforePrune
): RealtimeClientOptionsBeforePrune {
  const merged = deepMerge<RealtimeClientOptionsBeforePrune>(DEFAULTS, user);
  // Если greet.enabled true, а instructions не заданы — подставим дефолт
  if (
    merged.greet?.enabled &&
    (!merged.greet.response || !merged.greet.response.instructions)
  ) {
    merged.greet = {
      enabled: true,
      response: {
        instructions: DEFAULTS.greet!.response!.instructions!,
        modalities: DEFAULTS.greet!.response!.modalities,
      },
    };
  }
  return merged;
}

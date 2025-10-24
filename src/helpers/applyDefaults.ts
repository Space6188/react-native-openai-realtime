import type { RealtimeClientOptions } from '../types';
import { deepMerge } from './deepMerge';
import { DEFAULTS } from '../constants/defaultOptions';

export function applyDefaults(
  user: RealtimeClientOptions
): RealtimeClientOptions {
  const merged = deepMerge<RealtimeClientOptions>(DEFAULTS, user);
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

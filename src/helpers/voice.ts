// src/helpers/voice.ts
export const VOICE_IDS = [
  'verse',
  'alloy',
  'aria',
  'ballad',
  'calypso',
  'charlie',
  'sage',
  'opal',
] as const;

export type VoiceId = (typeof VOICE_IDS)[number];

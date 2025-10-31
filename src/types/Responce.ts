// src/types/Responce.ts
export type ResponseCreateParams = {
  instructions: string;
  modalities?: Array<'audio' | 'text'>;
  conversation?: 'auto' | 'none'; // <-- только 'auto' | 'none'
};

export type ResponseCreateOptions = {
  instructions?: string;
  modalities?: Array<'audio' | 'text'>;
  conversation?: 'auto' | 'none';
};

export type ResponseCreateStrict = Omit<
  ResponseCreateOptions,
  'instructions'
> & {
  instructions: string;
};

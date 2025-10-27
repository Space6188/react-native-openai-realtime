export type ResponseCreateParams = {
  instructions: string;
  modalities?: Array<'audio' | 'text'>;
};

export type ResponseCreateOptions = {
  instructions?: string;
  modalities?: Array<'audio' | 'text'>;
  conversation?: 'default' | 'none';
};

export type ResponseCreateStrict = Omit<
  ResponseCreateOptions,
  'instructions'
> & {
  instructions: string;
};

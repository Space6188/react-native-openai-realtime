export type ResponseCreateParams = {
  // Требуемый при явном вызове sendResponse(params)
  instructions: string;
  modalities?: Array<'audio' | 'text'>;
  // Можешь расширить, если используешь conversation options
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

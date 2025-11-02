export interface UseSessionOptionsParams {
  /** Client из useRealtime() */
  client: any;
  /** switchMode из useRealtime() */
  switchMode: (mode: 'voice' | 'text') => Promise<void>;
  /** Callback при успешной операции */
  onSuccess?: (
    stage:
      | 'voice_initialized'
      | 'voice_closed'
      | 'assistant_cancelled'
      | 'text_initialized'
  ) => void;
  /** Callback при ошибке */
  onError?: (
    stage:
      | 'voice_init'
      | 'voice_close'
      | 'assistant_cancel'
      | 'text_init'
      | 'text_close',
    error: any
  ) => void;
}

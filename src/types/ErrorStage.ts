export type ErrorStage =
  | 'hangup'
  | 'ice_gathering'
  | 'peer_connection'
  | 'microphone_permission'
  | 'remote_stream'
  | 'local_stream'
  | 'data_channel'
  | 'get_user_media'
  | 'ios_transceiver'
  | 'init_peer_connection'
  | 'create_offer'
  | 'set_local_description'
  | 'set_remote_description'
  | 'fetch_token'
  | 'openai_api';

export type ErrorSeverity = 'critical' | 'warning' | 'info';

export interface ErrorEvent {
  stage: ErrorStage;
  error: Error;
  severity: ErrorSeverity;
  recoverable: boolean;
  timestamp: number;
  context?: Record<string, any>;
}

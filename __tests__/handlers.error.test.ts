import { ErrorHandler } from '../src/handlers/index';

describe('ErrorHandler', () => {
  it('calls onError and logs', () => {
    const onError = jest.fn();
    const logger = { error: jest.fn() } as any;
    const eh = new ErrorHandler(onError, logger as any);
    const event = eh.handle(
      'data_channel',
      new Error('boom'),
      'warning',
      true,
      { x: 1 } as any
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'data_channel' })
    );
    expect(logger.error).toHaveBeenCalled();
    expect(event.recoverable).toBe(true);
  });

  it('handles string errors', () => {
    const eh = new ErrorHandler() as any;
    const event = eh.handle('openai_api', 'bad' as any, 'critical' as any);
    expect(event.error).toBeInstanceOf(Error);
  });
});

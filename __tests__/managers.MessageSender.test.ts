import { MessageSender } from '../src/managers/index';
import { ErrorHandler } from '../src/handlers/index';

test('MessageSender sendResponse / updateSession / middleware', async () => {
  const dataChannelManagerMock = {
    isOpen: () => true,
    send: jest.fn(),
  };

  const options: any = {
    middleware: {
      outgoing: [(e: any) => ({ ...e, patched: true })],
    },
  };

  const ms = new MessageSender(
    dataChannelManagerMock as any,
    options,
    new ErrorHandler()
  );

  await ms.sendResponse({ instructions: 'hi' } as any);
  await ms.updateSession({ voice: 'alloy' } as any);

  expect(dataChannelManagerMock.send).toHaveBeenCalledTimes(2);
  const firstCallArg = dataChannelManagerMock.send.mock.calls[0][0];
  expect(firstCallArg.patched).toBe(true);
});
test('MessageSender stop middleware cancels send', async () => {
  const dcMock: any = { isOpen: () => true, send: jest.fn() };
  const options: any = {
    middleware: {
      outgoing: [() => 'stop'],
    },
  };
  const ms = new MessageSender(
    dcMock as any,
    options as any,
    new ErrorHandler() as any
  );
  await ms.sendRaw({ type: 'x' } as any);
  expect(dcMock.send).not.toHaveBeenCalled();
});

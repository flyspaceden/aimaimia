import { Logger } from '@nestjs/common';
import * as WebSocket from 'ws';
import { AsrService } from './asr.service';

jest.mock('uuid', () => ({ v4: () => '12345678-1234-1234-1234-123456789abc' }));
jest.mock('ws', () => {
  const { EventEmitter } = jest.requireActual('events');
  return class FakeSocket extends EventEmitter {
    static OPEN = 1;
    static instances: FakeSocket[] = [];
    readyState = 0;
    send = jest.fn();
    close = jest.fn(() => { this.readyState = 3; this.emit('close', 1000, Buffer.alloc(0)); });
    constructor() { super(); FakeSocket.instances.push(this); }
  };
});

type Socket = WebSocket & { send: jest.Mock; close: jest.Mock; readyState: number };
const sockets = () => (WebSocket as unknown as { instances: Socket[] }).instances;
const event = (socket: Socket, name: string, payload: unknown = {}) => socket.emit('message', Buffer.from(JSON.stringify({ header: { event: name }, payload })));
const sentence = (socket: Socket, text: string, end = true) => event(socket, 'result-generated', { output: { sentence: { text, sentence_end: end } } });
const open = (socket: Socket) => { Object.assign(socket, { readyState: 1 }); socket.emit('open'); };

let service: AsrService;
const previousKey = process.env.DASHSCOPE_API_KEY;
beforeEach(() => {
  jest.useFakeTimers();
  sockets().length = 0;
  process.env.DASHSCOPE_API_KEY = 'unit-test-key';
  for (const level of ['log', 'debug', 'warn', 'error'] as const) jest.spyOn(Logger.prototype, level).mockImplementation(() => {});
  service = new AsrService();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = previousKey;
});

async function begin() {
  const result = service.recognize(Buffer.alloc(512), 'pcm');
  await Promise.resolve();
  const socket = sockets()[0];
  open(socket);
  return { result, socket };
}

describe('Paraformer recording transcription', () => {
  it('uses the active model and sends PCM only after task-started, followed by finish-task', async () => {
    const { result, socket } = await begin();
    const run = JSON.parse(socket.send.mock.calls[0][0]);
    expect(run.payload).toEqual({
      task_group: 'audio', task: 'asr', function: 'recognition',
      model: 'paraformer-realtime-v2', parameters: { format: 'pcm', sample_rate: 16000 }, input: {},
    });
    expect(socket.send).toHaveBeenCalledTimes(1);
    event(socket, 'task-started');
    expect(Buffer.isBuffer(socket.send.mock.calls[1][0])).toBe(true);
    const finish = JSON.parse(socket.send.mock.calls[2][0]);
    expect(finish.header).toMatchObject({ action: 'finish-task', task_id: run.header.task_id });
    event(socket, 'task-finished');
    await expect(result).resolves.toMatchObject({ text: '' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits for task-finished and keeps every final sentence, including a later constraint', async () => {
    const { result, socket } = await begin();
    let settled = false;
    void result.then(() => { settled = true; });
    event(socket, 'task-started');
    sentence(socket, '帮我找', false);
    sentence(socket, '帮我找苹果。');
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(socket.close).not.toHaveBeenCalled();
    sentence(socket, '不要超过五十元。');
    event(socket, 'task-finished');
    await expect(result).resolves.toMatchObject({ text: '帮我找苹果。不要超过五十元。' });
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['timeout', 'close', 'task-failed'])('rejects incomplete audio on %s instead of executing a partial instruction', async (failure) => {
    const { result, socket } = await begin();
    const rejected = expect(result).rejects.toThrow(/ASR/);
    event(socket, 'task-started');
    sentence(socket, '打开购物车。');
    if (failure === 'timeout') await jest.advanceTimersByTimeAsync(10000);
    else if (failure === 'close') socket.close();
    else socket.emit('message', Buffer.from(JSON.stringify({ header: { event: 'task-failed', error_message: 'Model not exist.' } })));
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reuses a prepared WebSocket once and still runs the new model', async () => {
    const prepared = service.prepareSession();
    open(sockets()[0]);
    const { prepareId } = await prepared;
    const result = service.recognize(Buffer.alloc(512), 'pcm', prepareId);
    await Promise.resolve();
    expect(sockets()).toHaveLength(1);
    const socket = sockets()[0];
    expect(JSON.parse(socket.send.mock.calls[0][0]).payload.model).toBe('paraformer-realtime-v2');
    event(socket, 'task-started');
    sentence(socket, '打开我的订单。');
    event(socket, 'task-finished');
    await expect(result).resolves.toMatchObject({ text: '打开我的订单。' });
    expect(jest.getTimerCount()).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { toGatewayHistory } from './chat-history';

describe('gateway history', () => {
  it('never replays failed or empty turns to a provider', () => {
    expect(toGatewayHistory([
      { role: 'USER', content: 'first', status: 'COMPLETED' },
      { role: 'ASSISTANT', content: '', status: 'ERROR' },
      { role: 'ASSISTANT', content: 'partial', status: 'ERROR' },
      { role: 'USER', content: 'again', status: 'COMPLETED' },
      { role: 'ASSISTANT', content: 'half an answer', status: 'INTERRUPTED' },
      { role: 'ASSISTANT', content: '  ', status: 'INTERRUPTED' },
      { role: 'USER', content: 'next', status: 'COMPLETED' },
    ])).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'half an answer' },
      { role: 'user', content: 'next' },
    ]);
  });
});

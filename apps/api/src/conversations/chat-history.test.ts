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

  it('replays a turn that only sent files as a note naming them', () => {
    const attachments = [{ id: 'a1', filename: 'report.pdf' }, { id: 'a2', filename: 'notes.md' }];
    expect(toGatewayHistory([
      { role: 'USER', content: '', status: 'COMPLETED', metadata: { attachments } },
      { role: 'ASSISTANT', content: 'Overview', status: 'COMPLETED' },
      { role: 'USER', content: 'Compare them', status: 'COMPLETED', metadata: { attachments } },
      { role: 'USER', content: '', status: 'COMPLETED', metadata: { tool: 'time' } },
    ])).toEqual([
      { role: 'user', content: '[Attached without a message: report.pdf, notes.md]' },
      { role: 'assistant', content: 'Overview' },
      { role: 'user', content: 'Compare them' },
    ]);
  });
});

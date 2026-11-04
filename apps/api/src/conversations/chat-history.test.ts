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

  describe('images', () => {
    const images = new Map([
      ['old', { filename: 'old.png', url: 'data:image/png;base64,b2xk' }],
      ['i1', { filename: 'receipt.webp', url: 'data:image/webp;base64,aTE=' }],
      ['i2', { filename: 'chart.jpg', url: 'data:image/jpeg;base64,aTI=' }],
    ]);
    const image = (id: string) => [
      { type: 'text', text: `[Image: ${images.get(id)!.filename}]` },
      { type: 'image_url', image_url: { url: images.get(id)!.url } },
    ];

    it('sends each image after the text of the turn that attached it', () => {
      expect(toGatewayHistory([
        { role: 'USER', content: '', status: 'COMPLETED', metadata: { attachments: [{ id: 'i1', filename: 'receipt.webp' }] } },
        { role: 'ASSISTANT', content: 'A receipt', status: 'COMPLETED' },
        { role: 'USER', content: 'And this?', status: 'COMPLETED', metadata: { attachments: [{ id: 'i2', filename: 'chart.jpg' }, { id: 'doc', filename: 'notes.md' }] } },
        { role: 'ASSISTANT', content: 'A chart', status: 'COMPLETED' },
        { role: 'USER', content: 'Thanks', status: 'COMPLETED' },
      ], new Map([...images].slice(1)))).toEqual([
        { role: 'user', content: [{ type: 'text', text: '[Attached without a message: receipt.webp]' }, ...image('i1')] },
        { role: 'assistant', content: 'A receipt' },
        { role: 'user', content: [{ type: 'text', text: 'And this?' }, ...image('i2')] },
        { role: 'assistant', content: 'A chart' },
        { role: 'user', content: 'Thanks' },
      ]);
    });

    it('sends images of turns too old to replay with the earliest replayed user turn, and each image once', () => {
      expect(toGatewayHistory([
        { role: 'ASSISTANT', content: 'An old answer', status: 'COMPLETED' },
        { role: 'USER', content: 'Look', status: 'COMPLETED', metadata: { attachments: [{ id: 'i1', filename: 'receipt.webp' }] } },
        { role: 'USER', content: 'Again', status: 'COMPLETED', metadata: { attachments: [{ id: 'i1', filename: 'receipt.webp' }, { id: 'i2', filename: 'chart.jpg' }] } },
      ], images)).toEqual([
        { role: 'assistant', content: 'An old answer' },
        { role: 'user', content: [{ type: 'text', text: 'Look' }, ...image('old'), ...image('i1')] },
        { role: 'user', content: [{ type: 'text', text: 'Again' }, ...image('i2')] },
      ]);
    });

    it('leaves out an image the chat no longer has', () => {
      expect(toGatewayHistory([
        { role: 'USER', content: 'Look', status: 'COMPLETED', metadata: { attachments: [{ id: 'gone', filename: 'gone.png' }] } },
      ], new Map())).toEqual([{ role: 'user', content: 'Look' }]);
    });
  });
});

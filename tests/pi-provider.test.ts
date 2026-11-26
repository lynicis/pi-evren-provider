import test from 'node:test';
import assert from 'node:assert/strict';
import { createModels } from '@earendil-works/pi-ai/compat';
import register from '../src/pi.ts';

test('native login, refresh, failed refresh, empty catalog and logout', async () => {
  const registry = createModels();
  register({ registerProvider: provider => registry.setProvider(provider) });
  const previous = globalThis.fetch;
  let catalog: 'one' | 'failed' | 'empty' = 'one';
  globalThis.fetch = async (url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-key');
    if (String(url).endsWith('/quota')) return Response.json({});
    if (String(url).endsWith('/responses')) {
      assert.equal(init?.method, 'POST');
      assert.equal(JSON.parse(String(init?.body)).model, 'tenant/gpt-new');
      const events = [
        { type: 'response.created', response: { id: 'resp-test' } },
        { type: 'response.output_item.added', output_index: 0, item: { id: 'msg-test', type: 'message', role: 'assistant', content: [] } },
        { type: 'response.output_text.delta', output_index: 0, delta: 'hello' },
        { type: 'response.completed', response: { id: 'resp-test', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }
    if (catalog === 'failed') return new Response('', { status: 503 });
    return Response.json({ data: catalog === 'one' ? [{ id: 'tenant/gpt-new' }] : [] });
  };
  try {
    await registry.login('evren', 'api_key', { prompt: async prompt => {
      assert.equal(prompt.type, 'secret');
      assert.equal(prompt.message, 'Evren API key');
      return 'test-key';
    }, notify() {} });
    await registry.refresh({ providers: ['evren'] });
    assert.equal((await registry.getAvailable('evren'))[0]?.id, 'tenant/gpt-new');
    catalog = 'failed';
    await registry.refresh({ providers: ['evren'] });
    const model = registry.getModel('evren', 'tenant/gpt-new');
    assert.ok(model);
    const completion = await registry.complete(model, { messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }] });
    assert.equal(completion.stopReason, 'stop');
    assert.equal(completion.content[0]?.type, 'text');
    assert.equal((await registry.getAvailable('evren'))[0]?.id, 'tenant/gpt-new');
    catalog = 'empty';
    await registry.refresh({ providers: ['evren'] });
    assert.deepEqual(await registry.getAvailable('evren'), []);
    await registry.logout('evren');
    assert.deepEqual(await registry.getAvailable('evren'), []);
  } finally { globalThis.fetch = previous; }
});

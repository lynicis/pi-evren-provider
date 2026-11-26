import { createProvider, openAIResponsesApi, type Provider } from '@earendil-works/pi-ai/compat';
import { EVREN_BASE_URL, fetchEvrenModels, validateEvrenKey } from './evren.ts';

export default function registerEvrenPiProvider(pi: { registerProvider(provider: Provider<'openai-responses'>): unknown }): void {
  pi.registerProvider(createProvider<'openai-responses'>({
    id: 'evren', name: 'Evren', baseUrl: EVREN_BASE_URL,
    auth: { apiKey: {
      name: 'Evren API key',
      async login(interaction) {
        const key = await interaction.prompt({ type: 'secret', message: 'Evren API key' });
        return { type: 'api_key', key: await validateEvrenKey(key, interaction.signal) };
      },
      async resolve({ credential }) {
        return credential?.key ? { auth: { apiKey: credential.key }, source: 'stored API key' } : undefined;
      },
    } },
    models: [],
    api: openAIResponsesApi(),
    async fetchModels({ credential, signal }) {
      if (credential?.type !== 'api_key' || !credential.key) return [];
      return (await fetchEvrenModels(credential.key, signal)).map(row => ({
        ...row, provider: 'evren', api: 'openai-responses' as const, baseUrl: EVREN_BASE_URL, reasoning: false,
      }));
    },
  }));
}

import { createEvrenProvider } from './provider.ts';

export default function registerEvrenProvider(pi: {
  registerProvider(name: string, descriptor: unknown): unknown;
}): void {
  createEvrenProvider(pi);
}

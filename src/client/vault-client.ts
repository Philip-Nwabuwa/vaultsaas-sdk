import type { VaultConfig } from '../types';

export class VaultClient {
  readonly config: VaultConfig;

  constructor(config: VaultConfig) {
    this.config = config;
  }
}

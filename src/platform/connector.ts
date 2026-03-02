import { BatchBuffer } from './buffer';

export interface PlatformConnectorConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
}

export class PlatformConnector {
  readonly config: PlatformConnectorConfig;
  readonly transactionBuffer: BatchBuffer<unknown>;
  readonly webhookBuffer: BatchBuffer<unknown>;

  constructor(config: PlatformConnectorConfig) {
    this.config = config;
    this.transactionBuffer = new BatchBuffer(100);
    this.webhookBuffer = new BatchBuffer(100);
  }
}

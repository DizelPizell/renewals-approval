import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface ProviderRenewalRequest {
  idempotencyKey: string;
  resourceId: string;
  amountMinor: number;
  currency: string;
}

export interface ProviderResponse {
  status: string;
  operation_id?: string;
  started_count?: number;
}

@Injectable()
export class ProviderService {
  private client: AxiosInstance;

  constructor(private config: ConfigService) {
    this.client = axios.create({
      baseURL: config.get<string>('PROVIDER_URL', 'http://127.0.0.1:8091'),
      timeout: parseInt(config.get<string>('PROVIDER_TIMEOUT_MS', '10000')),
    });
  }

  async createRenewal(req: ProviderRenewalRequest): Promise<ProviderResponse> {
    const response = await this.client.post(
      '/renewals',
      {
        resource_id: req.resourceId,
        period_months: 1,
        amount_minor: req.amountMinor,
        currency: req.currency,
      },
      {
        headers: { 'Idempotency-Key': req.idempotencyKey },
        validateStatus: () => true,
      },
    );

    if (response.status === 503) {
      throw new Error(`Provider 503: operation may have been saved`);
    }
    if (response.status >= 400) {
      throw new Error(`Provider error ${response.status}: ${JSON.stringify(response.data)}`);
    }
    return response.data;
  }

  async getOperation(idempotencyKey: string): Promise<ProviderResponse | null> {
    const encoded = encodeURIComponent(idempotencyKey);
    const response = await this.client.get(`/renewals/${encoded}`, {
      validateStatus: () => true,
    });

    if (response.status === 404) return null;
    if (response.status >= 400) {
      throw new Error(`Provider GET error ${response.status}`);
    }
    return response.data;
  }
}

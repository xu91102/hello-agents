import axios, { AxiosError, AxiosInstance } from 'axios';
import { AsyncLocalStorage } from 'async_hooks';
import { getConfig } from '../config';
import type { ErpApiResponse } from '../core/types';
import { logger } from '../logger';

function readApiMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const body = data as Record<string, unknown>;
  const message = body['message'] ?? body['Message'] ?? body['msg'] ?? body['error'];
  if (typeof message === 'string' && message.trim()) {
    return message;
  }

  const errors = body['errors'] ?? body['Errors'];
  if (Array.isArray(errors)) {
    return errors.filter((item) => typeof item === 'string' && item.trim()).join('; ');
  }

  return undefined;
}

/**
 * ERP WebAPI HTTP client.
 * Centralizes auth, logging, timeout, and response unwrapping.
 */
class ErpClient {
  private http: AxiosInstance;
  private token: string;
  private authContext = new AsyncLocalStorage<{ authorization?: string }>();

  constructor() {
    const cfg = getConfig();
    this.token = cfg.erpApiToken;

    this.http = axios.create({
      baseURL: cfg.erpApiBaseUrl,
      timeout: cfg.toolTimeoutMs,
      headers: { 'Content-Type': 'application/json' },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.http.interceptors.request.use((config) => {
      if (this.token) {
        config.headers['X-Agent-Api-Key'] = this.token;
      }
      const authorization = this.authContext.getStore()?.authorization;
      if (authorization) {
        config.headers['Authorization'] = authorization;
      }
      const fullUrl =
        config.baseURL && config.url
          ? `${config.baseURL.replace(/\/$/, '')}/${config.url.replace(/^\//, '')}`
          : config.url;
      logger.info(
        { method: config.method?.toUpperCase(), path: config.url, fullUrl },
        'ERP 请求后端',
      );
      return config;
    });

    this.http.interceptors.response.use(
      (response) => {
        const dataLen = response.data?.data != null ? '(有数据)' : '(空)';
        logger.info(
          { path: response.config.url, status: response.status, data: dataLen },
          'ERP 后端响应',
        );
        return response;
      },
      (error: AxiosError) => {
        const apiMessage = readApiMessage(error.response?.data);
        logger.error(
          {
            url: error.config?.url,
            status: error.response?.status,
            message: apiMessage ?? error.message,
          },
          'ERP API 请求失败',
        );
        return Promise.reject(new Error(apiMessage ?? error.message));
      },
    );
  }

  setToken(token: string): void {
    this.token = token;
  }

  async runWithAuthorization<T>(authorization: string | undefined, handler: () => Promise<T>): Promise<T> {
    return this.authContext.run({ authorization }, handler);
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.http.get<ErpApiResponse<T>>(path, { params });
    return this.unwrap(response.data);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.http.post<ErpApiResponse<T>>(path, body);
    return this.unwrap(response.data);
  }

  private unwrap<T>(response: ErpApiResponse<T>): T {
    const isSuccess = response.success ?? (response.code === 0 || response.code === 200);
    if (!isSuccess) {
      const message = response.message ?? readApiMessage(response) ?? '';
      throw new Error(`ERP API 错误 [${response.code}]: ${message}`.trim());
    }
    return response.data;
  }
}

export const erpClient = new ErpClient();

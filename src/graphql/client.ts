/**
 * GraphQL client: POST /graphql with timeout, abort, typed errors, and in-flight
 * deduplication of identical queries. Callers own any result caching (see StashAPI).
 */

import {
  GraphQLResponse,
  GraphQLError,
  TypedGraphQLClient,
  GraphQLQueryOptions,
  GraphQLMutationOptions,
} from './types.js';
import {
  GraphQLAbortError,
  GraphQLNetworkError,
  GraphQLRequestError,
  GraphQLResponseError,
  isAbortError,
  createGraphQLError,
} from './errors.js';
import { getStashBaseUrl } from '../utils/baseUrl.js';

interface StashPluginApi {
  GQL: {
    client?: TypedGraphQLClient;
  };
  baseURL?: string;
  apiKey?: string;
}

interface GraphQLClientConfig {
  baseUrl?: string;
  apiKey?: string;
  pluginApi?: StashPluginApi;
  timeout?: number; // Request timeout in milliseconds (default: 30000, 0 = none)
}

type Result<TData> = { data?: TData; errors?: GraphQLError[] };

function isGraphQLError(error: unknown): boolean {
  return error instanceof GraphQLAbortError
    || error instanceof GraphQLNetworkError
    || error instanceof GraphQLRequestError
    || error instanceof GraphQLResponseError;
}

export class GraphQLClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly pluginApi?: StashPluginApi;
  private readonly timeout: number;

  /** In-flight queries by operation + variables + abort signal. */
  private readonly pendingRequests = new Map<string, Promise<unknown>>();
  private readonly signalIds = new WeakMap<AbortSignal, number>();
  private nextSignalId = 1;

  constructor(config: GraphQLClientConfig = {}) {
    const windowWithStash = globalThis.window as typeof globalThis.window & {
      PluginApi?: StashPluginApi;
      stash?: StashPluginApi;
    };
    this.pluginApi = config.pluginApi || windowWithStash.PluginApi || windowWithStash.stash;
    this.baseUrl = config.baseUrl || this.pluginApi?.baseURL || getStashBaseUrl();
    this.apiKey = config.apiKey || this.pluginApi?.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  async query<TData = unknown, TVariables extends Record<string, unknown> | undefined = Record<string, unknown>>(
    options: GraphQLQueryOptions<TVariables, TData>
  ): Promise<Result<TData>> {
    const { query, variables, signal } = options;
    this.assertOperation(query, 'Query');
    this.checkAbort(signal);

    const pluginClient = this.pluginApi?.GQL?.client;
    if (pluginClient) {
      return this.viaPluginClient(() => pluginClient.query<TData, TVariables>({ query, variables, signal }), signal);
    }

    // Identical in-flight queries share one request, but only between callers using the same
    // abort signal: the shared request carries the first caller's signal.
    const key = JSON.stringify([query, variables]) + this.signalTag(signal);
    const pending = this.pendingRequests.get(key);
    if (pending) return pending as Promise<Result<TData>>;

    const request = this.execute<TData>(query, variables, signal);
    this.pendingRequests.set(key, request);
    try {
      return await request;
    } finally {
      this.pendingRequests.delete(key);
    }
  }

  /** Mutations are never deduplicated: they have side effects. */
  async mutate<TData = unknown, TVariables extends Record<string, unknown> | undefined = Record<string, unknown>>(
    options: GraphQLMutationOptions<TVariables, TData>
  ): Promise<Result<TData>> {
    const { mutation, variables, signal } = options;
    this.assertOperation(mutation, 'Mutation');
    this.checkAbort(signal);

    const pluginClient = this.pluginApi?.GQL?.client;
    if (pluginClient) {
      return this.viaPluginClient(() => pluginClient.mutate<TData, TVariables>({ mutation, variables, signal }), signal);
    }
    return this.execute<TData>(mutation, variables, signal);
  }

  destroy(): void {
    this.pendingRequests.clear();
  }

  private assertOperation(operation: unknown, kind: string): void {
    if (!operation || typeof operation !== 'string' || operation.trim().length === 0) {
      throw new Error(`${kind} string must be a non-empty string`);
    }
  }

  private checkAbort(signal?: AbortSignal): void {
    if (signal?.aborted) throw new GraphQLAbortError();
  }

  private signalTag(signal?: AbortSignal): string {
    if (!signal) return '';
    let id = this.signalIds.get(signal);
    if (id === undefined) {
      id = this.nextSignalId++;
      this.signalIds.set(signal, id);
    }
    return `|s${id}`;
  }

  private async viaPluginClient<TData>(operation: () => Promise<Result<TData>>, signal?: AbortSignal): Promise<Result<TData>> {
    try {
      const result = await operation();
      this.checkAbort(signal);
      return result;
    } catch (error: unknown) {
      throw this.normalizeError(error, null, signal);
    }
  }

  /** Map anything thrown while talking to the server onto the typed GraphQL errors. */
  private normalizeError(error: unknown, response: Response | null, signal?: AbortSignal): Error {
    if (isAbortError(error) || signal?.aborted) return new GraphQLAbortError();
    if (isGraphQLError(error)) return error as Error;
    return createGraphQLError(response, null, error instanceof Error ? error : new Error('Network request failed'));
  }

  private async execute<TData>(
    operation: string,
    variables: Record<string, unknown> | undefined,
    signal?: AbortSignal
  ): Promise<Result<TData>> {
    // One signal for caller-abort and timeout; listener and timer are released in finally.
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = this.timeout > 0 ? setTimeout(abort, this.timeout) : undefined;

    let response: Response | null = null;
    try {
      response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { ApiKey: this.apiKey }),
        },
        body: JSON.stringify({ query: operation, variables }),
        signal: controller.signal,
        cache: 'no-cache',
      });
      return await this.parseResponse<TData>(response, controller.signal);
    } catch (error: unknown) {
      throw this.normalizeError(error, response, controller.signal);
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  private async parseResponse<TData>(response: Response, signal: AbortSignal): Promise<Result<TData>> {
    this.checkAbort(signal);

    const contentType = response.headers.get('content-type');
    if (!contentType || (!contentType.includes('application/json') && !contentType.includes('application/graphql-response+json'))) {
      const text = await response.text();
      throw createGraphQLError(response, null, new Error(`Unexpected content type: ${contentType}. Response: ${text.substring(0, 200)}`));
    }

    const body = (await response.json()) as GraphQLResponse<TData>;
    this.checkAbort(signal);
    if ((body.errors && body.errors.length > 0) || !response.ok) {
      throw createGraphQLError(response, body);
    }
    return { data: body.data, errors: body.errors };
  }
}

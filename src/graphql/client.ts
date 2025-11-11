/**
 * Centralized GraphQL Client
 * Provides a unified interface for GraphQL queries and mutations
 * with request deduplication, error handling, and abort support
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
  isAbortError,
  createGraphQLError,
} from './errors.js';

interface StashPluginApi {
  GQL: {
    useFindScenesQuery?: (variables: unknown) => { data?: unknown; loading: boolean };
    client?: TypedGraphQLClient;
  };
  baseURL?: string;
  apiKey?: string;
}

interface GraphQLClientConfig {
  baseUrl?: string;
  apiKey?: string;
  pluginApi?: StashPluginApi;
}

/**
 * Centralized GraphQL Client
 */
export class GraphQLClient {
  private baseUrl: string;
  private apiKey?: string;
  private pluginApi?: StashPluginApi;
  // Request deduplication - cache in-flight requests
  private pendingRequests: Map<string, Promise<unknown>> = new Map();

  constructor(config: GraphQLClientConfig = {}) {
    // Get from window if available (Stash plugin context)
    const windowWithStash = window as typeof window & {
      PluginApi?: StashPluginApi;
      stash?: StashPluginApi;
    };
    this.pluginApi = config.pluginApi || windowWithStash.PluginApi || windowWithStash.stash;

    // Try to get base URL from various sources
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl;
    } else if (this.pluginApi?.baseURL) {
      this.baseUrl = this.pluginApi.baseURL;
    } else {
      // Fallback: use current origin (for plugin context)
      this.baseUrl = window.location.origin;
    }

    this.apiKey = config.apiKey || this.pluginApi?.apiKey;
  }

  /**
   * Execute a GraphQL query
   */
  async query<TData = unknown, TVariables = Record<string, unknown>>(
    options: GraphQLQueryOptions<TVariables, TData>
  ): Promise<{ data?: TData; errors?: GraphQLError[] }> {
    const { query, variables, signal } = options;

    // Check if already aborted
    if (signal?.aborted) {
      throw new GraphQLAbortError();
    }

    // Use plugin API client if available
    if (this.pluginApi?.GQL?.client) {
      try {
        const result = await this.pluginApi.GQL.client.query<TData, TVariables>({
          query,
          variables,
          signal,
        });
        if (signal?.aborted) {
          throw new GraphQLAbortError();
        }
        return result;
      } catch (error: unknown) {
        if (isAbortError(error) || signal?.aborted) {
          throw new GraphQLAbortError();
        }
        throw error;
      }
    }

    // Fallback to fetch with deduplication
    return this._fetchQuery<TData, TVariables>(query, variables, signal);
  }

  /**
   * Execute a GraphQL mutation
   */
  async mutate<TData = unknown, TVariables = Record<string, unknown>>(
    options: GraphQLMutationOptions<TVariables, TData>
  ): Promise<{ data?: TData; errors?: GraphQLError[] }> {
    const { mutation, variables, signal } = options;

    // Check if already aborted
    if (signal?.aborted) {
      throw new GraphQLAbortError();
    }

    // Use plugin API client if available
    if (this.pluginApi?.GQL?.client) {
      try {
        const result = await this.pluginApi.GQL.client.mutate<TData, TVariables>({
          mutation,
          variables,
          signal,
        });
        if (signal?.aborted) {
          throw new GraphQLAbortError();
        }
        return result;
      } catch (error: unknown) {
        if (isAbortError(error) || signal?.aborted) {
          throw new GraphQLAbortError();
        }
        throw error;
      }
    }

    // Fallback to fetch with deduplication
    return this._fetchMutation<TData, TVariables>(mutation, variables, signal);
  }

  /**
   * Internal: Execute query with fetch (with deduplication)
   */
  private async _fetchQuery<TData, TVariables>(
    query: string,
    variables?: TVariables,
    signal?: AbortSignal
  ): Promise<{ data?: TData; errors?: GraphQLError[] }> {
    // Create request key for deduplication
    const requestKey = this._getRequestKey('query', query, variables);

    // Check for in-flight request
    const pending = this.pendingRequests.get(requestKey);
    if (pending) {
      return pending as Promise<{ data?: TData; errors?: GraphQLError[] }>;
    }

    // Create new request
    const request = this._executeFetch<TData>(query, variables, signal);

    // Store for deduplication
    this.pendingRequests.set(requestKey, request);

    try {
      return await request;
    } finally {
      // Remove from pending requests
      this.pendingRequests.delete(requestKey);
    }
  }

  /**
   * Internal: Execute mutation with fetch (with deduplication)
   */
  private async _fetchMutation<TData, TVariables>(
    mutation: string,
    variables?: TVariables,
    signal?: AbortSignal
  ): Promise<{ data?: TData; errors?: GraphQLError[] }> {
    // Create request key for deduplication
    const requestKey = this._getRequestKey('mutation', mutation, variables);

    // Check for in-flight request
    const pending = this.pendingRequests.get(requestKey);
    if (pending) {
      return pending as Promise<{ data?: TData; errors?: GraphQLError[] }>;
    }

    // Create new request
    const request = this._executeFetch<TData>(mutation, variables, signal);

    // Store for deduplication
    this.pendingRequests.set(requestKey, request);

    try {
      return await request;
    } finally {
      // Remove from pending requests
      this.pendingRequests.delete(requestKey);
    }
  }

  /**
   * Internal: Execute fetch request
   */
  private async _executeFetch<TData>(
    operation: string,
    variables?: unknown,
    signal?: AbortSignal
  ): Promise<{ data?: TData; errors?: GraphQLError[] }> {
    // Check if already aborted
    if (signal?.aborted) {
      throw new GraphQLAbortError();
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey && { ApiKey: this.apiKey }),
        },
        body: JSON.stringify({
          query: operation,
          variables,
        }),
        signal,
      });
    } catch (error: unknown) {
      if (isAbortError(error) || signal?.aborted) {
        throw new GraphQLAbortError();
      }
      throw createGraphQLError(null, null, error instanceof Error ? error : new Error('Network request failed'));
    }

    // Check if aborted after fetch
    if (signal?.aborted) {
      throw new GraphQLAbortError();
    }

    // Parse response
    let data: GraphQLResponse<TData> | null = null;
    try {
      // Check content type before parsing
      // Accept both application/json and application/graphql-response+json (GraphQL over HTTP spec)
      const contentType = response.headers.get('content-type');
      if (contentType && (contentType.includes('application/json') || contentType.includes('application/graphql-response+json'))) {
        data = (await response.json()) as GraphQLResponse<TData>;
      } else {
        // Non-JSON response - likely an error
        const text = await response.text();
        throw createGraphQLError(
          response,
          null,
          new Error(`Unexpected content type: ${contentType}. Response: ${text.substring(0, 200)}`)
        );
      }
    } catch (parseError: unknown) {
      if (isAbortError(parseError) || signal?.aborted) {
        throw new GraphQLAbortError();
      }
      throw createGraphQLError(
        response,
        null,
        parseError instanceof Error ? parseError : new Error('Failed to parse response')
      );
    }

    // Check if aborted after parsing
    if (signal?.aborted) {
      throw new GraphQLAbortError();
    }

    // Check for GraphQL errors
    if (data.errors && data.errors.length > 0) {
      const error = createGraphQLError(response, data);
      throw error;
    }

    // Check for network errors
    if (!response.ok) {
      const error = createGraphQLError(response, data);
      throw error;
    }

    return {
      data: data.data,
      errors: data.errors,
    };
  }

  /**
   * Generate a unique request key for deduplication
   */
  private _getRequestKey(type: 'query' | 'mutation', operation: string, variables?: unknown): string {
    // Create a stable key from operation and variables
    const varsKey = variables ? JSON.stringify(variables) : '';
    return `${type}:${operation}:${varsKey}`;
  }

  /**
   * Clear all pending requests (useful for cleanup)
   */
  clearPendingRequests(): void {
    this.pendingRequests.clear();
  }
}


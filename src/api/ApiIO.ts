import type { GraphQLClient } from '../graphql/client.js';
import {
  GraphQLRequestError,
  GraphQLResponseError,
  GraphQLNetworkError,
  isAbortError,
} from '../graphql/errors.js';

export class ApiIO {
  constructor(private readonly client: () => GraphQLClient) {}

  get gql(): GraphQLClient {
    return this.client();
  }

  readonly aliasedExec = async (query: string, variables: Record<string, unknown>) =>
    (await this.gql.query<Record<string, unknown>>({ query, variables })).data;

  isAborted(signal?: AbortSignal): boolean {
    return signal?.aborted ?? false;
  }

  logError(method: string, error: unknown): void {
    if (error instanceof GraphQLRequestError || error instanceof GraphQLResponseError || error instanceof GraphQLNetworkError) {
      console.warn(`[StashAPI] ${method} failed`, error);
    } else {
      console.warn(`[StashAPI] ${method} failed`, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  rethrowUnlessAbort<T>(method: string, error: unknown, signal: AbortSignal | undefined, emptyResult: T): T {
    if (isAbortError(error) || this.isAborted(signal)) return emptyResult;
    this.logError(method, error);
    throw error;
  }

  handleError<T>(method: string, error: unknown, signal: AbortSignal | undefined, emptyResult: T): T {
    if (!isAbortError(error) && !this.isAborted(signal)) this.logError(method, error);
    return emptyResult;
  }
}

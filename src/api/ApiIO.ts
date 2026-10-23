/**
 * What every API module needs from the transport: the (swappable) GraphQL client, abort checks and
 * consistent error handling. Modules take this instead of reaching into StashAPI.
 */

import type { GraphQLClient } from '../graphql/client.js';
import {
  GraphQLRequestError,
  GraphQLResponseError,
  GraphQLNetworkError,
  isAbortError,
} from '../graphql/errors.js';

export class ApiIO {
  /** @param client Resolved on every use, so a replaced client (tests, reconfiguration) is picked up. */
  constructor(private readonly client: () => GraphQLClient) {}

  get gql(): GraphQLClient {
    return this.client();
  }

  /** Executor for runAliased: our GraphQL client, data only (errors throw). */
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

  /**
   * For reads whose callers must tell "failed" from "empty": an abort yields `emptyResult`,
   * anything else is logged and rethrown (so a transient error is never mistaken for
   * "no saved filter" / "no stash-boxes" / "server has no settings" and acted on).
   */
  rethrowUnlessAbort<T>(method: string, error: unknown, signal: AbortSignal | undefined, emptyResult: T): T {
    if (isAbortError(error) || this.isAborted(signal)) return emptyResult;
    this.logError(method, error);
    throw error;
  }

  /** Aborted operations return `emptyResult` quietly; other errors are logged and also yield `emptyResult`. */
  handleError<T>(method: string, error: unknown, signal: AbortSignal | undefined, emptyResult: T): T {
    if (!isAbortError(error) && !this.isAborted(signal)) this.logError(method, error);
    return emptyResult;
  }
}

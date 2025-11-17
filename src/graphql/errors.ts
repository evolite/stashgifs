/**
 * GraphQL Error Handling
 * Typed error classes for consistent error handling
 */

import { GraphQLError } from './types.js';

/**
 * Base GraphQL error class
 */
export class GraphQLRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly graphQLErrors?: GraphQLError[],
    public readonly networkError?: Error
  ) {
    super(message);
    this.name = 'GraphQLRequestError';
    Object.setPrototypeOf(this, GraphQLRequestError.prototype);
  }
}

/**
 * GraphQL response error (errors in data.errors)
 */
export class GraphQLResponseError extends Error {
  constructor(
    message: string,
    public readonly graphQLErrors: GraphQLError[]
  ) {
    super(message);
    this.name = 'GraphQLResponseError';
    Object.setPrototypeOf(this, GraphQLResponseError.prototype);
  }
}

/**
 * Network error (fetch failed)
 */
export class GraphQLNetworkError extends Error {
  constructor(
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'GraphQLNetworkError';
    Object.setPrototypeOf(this, GraphQLNetworkError.prototype);
  }
}

/**
 * Abort error (request was cancelled)
 */
export class GraphQLAbortError extends Error {
  constructor(message: string = 'Request was aborted') {
    super(message);
    this.name = 'GraphQLAbortError';
    Object.setPrototypeOf(this, GraphQLAbortError.prototype);
  }
}

/**
 * Helper to check if error is an abort error
 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof GraphQLAbortError ||
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

/**
 * Helper to create error from GraphQL response
 */
export function createGraphQLError(
  response: Response | null,
  data: { errors?: GraphQLError[] } | null,
  originalError?: Error
): Error {
  // Check for abort first
  if (originalError && isAbortError(originalError)) {
    return new GraphQLAbortError();
  }

  // Check for network errors
  if (!response?.ok) {
    return new GraphQLNetworkError(
      `GraphQL request failed: ${response?.status || 'unknown'} ${response?.statusText || ''}`,
      originalError
    );
  }

  // Check for GraphQL errors in response
  if (data?.errors && data.errors.length > 0) {
    const errorMessages = data.errors.map(e => e.message).join(', ');
    return new GraphQLResponseError(
      `GraphQL errors: ${errorMessages}`,
      data.errors
    );
  }

  // Generic error
  return new GraphQLRequestError(
    originalError?.message || 'Unknown GraphQL error',
    response?.status,
    data?.errors,
    originalError
  );
}

/**
 * Helper to handle GraphQL errors consistently
 */
export function handleGraphQLError(
  error: unknown,
  context?: string
): never {
  if (isAbortError(error)) {
    throw new GraphQLAbortError();
  }

  if (error instanceof GraphQLRequestError || 
      error instanceof GraphQLResponseError || 
      error instanceof GraphQLNetworkError) {
    throw error;
  }

  // Wrap unknown errors
  let message: string;
  if (context) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    message = `${context}: ${errorMessage}`;
  } else {
    message = error instanceof Error ? error.message : 'Unknown error';
  }
  
  throw new GraphQLRequestError(message);
}


/**
 * GraphQL Error Handling
 * Typed error classes for consistent error handling
 */
/**
 * Base GraphQL error class
 */
export class GraphQLRequestError extends Error {
    constructor(message, status, graphQLErrors, networkError) {
        super(message);
        this.status = status;
        this.graphQLErrors = graphQLErrors;
        this.networkError = networkError;
        this.name = 'GraphQLRequestError';
        Object.setPrototypeOf(this, GraphQLRequestError.prototype);
    }
}
/**
 * GraphQL response error (errors in data.errors)
 */
export class GraphQLResponseError extends Error {
    constructor(message, graphQLErrors) {
        super(message);
        this.graphQLErrors = graphQLErrors;
        this.name = 'GraphQLResponseError';
        Object.setPrototypeOf(this, GraphQLResponseError.prototype);
    }
}
/**
 * Network error (fetch failed)
 */
export class GraphQLNetworkError extends Error {
    constructor(message, originalError) {
        super(message);
        this.originalError = originalError;
        this.name = 'GraphQLNetworkError';
        Object.setPrototypeOf(this, GraphQLNetworkError.prototype);
    }
}
/**
 * Abort error (request was cancelled)
 */
export class GraphQLAbortError extends Error {
    constructor(message = 'Request was aborted') {
        super(message);
        this.name = 'GraphQLAbortError';
        Object.setPrototypeOf(this, GraphQLAbortError.prototype);
    }
}
/**
 * Helper to check if error is an abort error
 */
export function isAbortError(error) {
    return (error instanceof GraphQLAbortError ||
        (error instanceof Error && error.name === 'AbortError') ||
        (error instanceof DOMException && error.name === 'AbortError'));
}
/**
 * Helper to create error from GraphQL response
 */
export function createGraphQLError(response, data, originalError) {
    // Check for abort first
    if (originalError && isAbortError(originalError)) {
        return new GraphQLAbortError();
    }
    // Check for network errors
    if (!response?.ok) {
        return new GraphQLNetworkError(`GraphQL request failed: ${response?.status || 'unknown'} ${response?.statusText || ''}`, originalError);
    }
    // Check for GraphQL errors in response
    if (data?.errors && data.errors.length > 0) {
        const errorMessages = data.errors.map(e => e.message).join(', ');
        return new GraphQLResponseError(`GraphQL errors: ${errorMessages}`, data.errors);
    }
    // Generic error
    return new GraphQLRequestError(originalError?.message || 'Unknown GraphQL error', response?.status, data?.errors, originalError);
}
/**
 * Helper to handle GraphQL errors consistently
 */
export function handleGraphQLError(error, context) {
    if (isAbortError(error)) {
        throw new GraphQLAbortError();
    }
    if (error instanceof GraphQLRequestError ||
        error instanceof GraphQLResponseError ||
        error instanceof GraphQLNetworkError) {
        throw error;
    }
    // Wrap unknown errors
    let message;
    if (context) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        message = `${context}: ${errorMessage}`;
    }
    else {
        message = error instanceof Error ? error.message : 'Unknown error';
    }
    throw new GraphQLRequestError(message);
}
//# sourceMappingURL=errors.js.map
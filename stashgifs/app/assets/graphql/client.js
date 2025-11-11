/**
 * Centralized GraphQL Client
 * Provides a unified interface for GraphQL queries and mutations
 * with request deduplication, error handling, and abort support
 */
import { GraphQLAbortError, isAbortError, createGraphQLError, } from './errors.js';
/**
 * Centralized GraphQL Client
 */
export class GraphQLClient {
    constructor(config = {}) {
        // Request deduplication - cache in-flight requests (queries only)
        // Using Map maintains insertion order for LRU eviction
        this.pendingRequests = new Map();
        // Response cache for queries
        this.responseCache = new Map();
        // Memoized request keys to avoid repeated JSON.stringify
        // Using Map with size limit instead of WeakMap for better hit rates
        this.keyCache = new Map();
        this.maxKeyCacheSize = 1000;
        // Request batching queue
        this.batchQueue = [];
        this.batchFlushing = false;
        // Get from window if available (Stash plugin context)
        const windowWithStash = window;
        this.pluginApi = config.pluginApi || windowWithStash.PluginApi || windowWithStash.stash;
        // Try to get base URL from various sources
        if (config.baseUrl) {
            this.baseUrl = config.baseUrl;
        }
        else if (this.pluginApi?.baseURL) {
            this.baseUrl = this.pluginApi.baseURL;
        }
        else {
            // Fallback: use current origin (for plugin context)
            this.baseUrl = window.location.origin;
        }
        this.apiKey = config.apiKey || this.pluginApi?.apiKey;
        this.timeout = config.timeout ?? 30000; // Default 30 seconds
        this.maxPendingRequests = config.maxPendingRequests ?? 100;
        this.enableResponseCache = config.enableResponseCache ?? false;
        this.cacheTTL = config.cacheTTL ?? 300000; // Default 5 minutes
        this.enableBatching = config.enableBatching ?? false;
        this.batchDelay = config.batchDelay ?? 10; // Default 10ms
        this.maxBatchSize = config.maxBatchSize ?? 10; // Default 10 operations per batch
        // Start periodic cache cleanup
        if (this.enableResponseCache) {
            this.startCacheCleanup();
        }
    }
    /**
     * Start periodic cache cleanup to prevent memory leaks
     * Stores interval ID so it can be cleared when client is destroyed
     */
    startCacheCleanup() {
        if (this.cacheCleanupInterval) {
            clearInterval(this.cacheCleanupInterval);
        }
        this.cacheCleanupInterval = setInterval(() => {
            this.cleanupExpiredCache();
        }, Math.min(this.cacheTTL, 60000)); // Clean up at least every minute or TTL, whichever is smaller
    }
    /**
     * Stop cache cleanup interval (for cleanup/destroy)
     */
    stopCacheCleanup() {
        if (this.cacheCleanupInterval) {
            clearInterval(this.cacheCleanupInterval);
            this.cacheCleanupInterval = undefined;
        }
    }
    /**
     * Clean up expired cache entries
     * Processes entries in batches to avoid UI freezes on large caches
     * Uses requestIdleCallback when available, otherwise processes in chunks
     */
    cleanupExpiredCache() {
        const now = Date.now();
        const entries = Array.from(this.responseCache.entries());
        const maxEntriesPerCycle = 100; // Limit entries processed per cleanup cycle
        if (entries.length <= maxEntriesPerCycle) {
            // Small cache - process all at once
            for (const [key, entry] of entries) {
                if (now - entry.timestamp > entry.ttl) {
                    this.responseCache.delete(key);
                }
            }
        }
        else {
            // Large cache - process in batches
            const processBatch = (startIndex) => {
                const endIndex = Math.min(startIndex + maxEntriesPerCycle, entries.length);
                for (let i = startIndex; i < endIndex; i++) {
                    const [key, entry] = entries[i];
                    if (now - entry.timestamp > entry.ttl) {
                        this.responseCache.delete(key);
                    }
                }
                if (endIndex < entries.length) {
                    // Use requestIdleCallback if available, otherwise setTimeout
                    if (typeof requestIdleCallback !== 'undefined') {
                        requestIdleCallback(() => processBatch(endIndex), { timeout: 1000 });
                    }
                    else {
                        setTimeout(() => processBatch(endIndex), 0);
                    }
                }
            };
            processBatch(0);
        }
    }
    /**
     * Check if request should be aborted (helper to reduce redundant checks)
     * Only call at critical points: before network requests and after async operations
     */
    checkAbort(signal) {
        if (signal?.aborted) {
            throw new GraphQLAbortError();
        }
    }
    /**
     * Standardized error handling for GraphQL operations
     * Converts all errors to appropriate GraphQL error types
     */
    handleError(error, signal) {
        if (isAbortError(error) || signal?.aborted) {
            throw new GraphQLAbortError();
        }
        // Re-throw GraphQL errors as-is
        if (error instanceof GraphQLAbortError ||
            error instanceof Error &&
                (error.name === 'GraphQLRequestError' ||
                    error.name === 'GraphQLResponseError' ||
                    error.name === 'GraphQLNetworkError')) {
            throw error;
        }
        // Wrap unknown errors
        throw error instanceof Error ? error : new Error(String(error));
    }
    /**
     * Execute a GraphQL query
     */
    async query(options) {
        const { query, variables, signal } = options;
        // Validate input
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            throw new Error('Query string must be a non-empty string');
        }
        this.checkAbort(signal);
        // Use plugin API client if available
        if (this.pluginApi?.GQL?.client) {
            return this._executeWithPluginClient(() => this.pluginApi.GQL.client.query({
                query,
                variables,
                signal,
            }), signal);
        }
        // Fallback to fetch with deduplication and caching
        if (this.enableBatching) {
            return this._batchQuery(query, variables, signal);
        }
        return this._fetchQuery(query, variables, signal);
    }
    /**
     * Execute a GraphQL mutation
     */
    async mutate(options) {
        const { mutation, variables, signal } = options;
        // Validate input
        if (!mutation || typeof mutation !== 'string' || mutation.trim().length === 0) {
            throw new Error('Mutation string must be a non-empty string');
        }
        this.checkAbort(signal);
        // Use plugin API client if available
        if (this.pluginApi?.GQL?.client) {
            return this._executeWithPluginClient(() => this.pluginApi.GQL.client.mutate({
                mutation,
                variables,
                signal,
            }), signal);
        }
        // Fallback to fetch - mutations are NOT deduplicated (they have side effects)
        return this._fetchMutation(mutation, variables, signal);
    }
    /**
     * Common error handling for plugin API client calls
     */
    async _executeWithPluginClient(operation, signal) {
        return this._handleOperationError(() => operation(), signal);
    }
    /**
     * Common error handling wrapper for async operations
     * Standardizes error handling and abort checking
     */
    async _handleOperationError(operation, signal) {
        try {
            const result = await operation();
            // Check abort after async operation completes
            this.checkAbort(signal);
            return result;
        }
        catch (error) {
            this.handleError(error, signal);
        }
    }
    /**
     * Common response parsing and error checking
     * Checks abort only at critical points: before parsing and after async operations
     */
    async _parseResponse(response, signal) {
        // Check abort before starting parse operation
        this.checkAbort(signal);
        // Check content type before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || (!contentType.includes('application/json') && !contentType.includes('application/graphql-response+json'))) {
            const text = await response.text();
            throw createGraphQLError(response, null, new Error(`Unexpected content type: ${contentType}. Response: ${text.substring(0, 200)}`));
        }
        try {
            const data = (await response.json());
            // Check abort after async JSON parse
            this.checkAbort(signal);
            // Check for GraphQL errors
            if (data.errors && data.errors.length > 0) {
                throw createGraphQLError(response, data);
            }
            // Check for network errors
            if (!response.ok) {
                throw createGraphQLError(response, data);
            }
            return data;
        }
        catch (parseError) {
            // Check for abort first
            if (isAbortError(parseError) || signal?.aborted) {
                throw new GraphQLAbortError();
            }
            // If it's already a GraphQL error, re-throw it
            if (parseError instanceof Error &&
                (parseError.name === 'GraphQLRequestError' ||
                    parseError.name === 'GraphQLResponseError' ||
                    parseError.name === 'GraphQLNetworkError')) {
                throw parseError;
            }
            // Wrap parse errors
            throw createGraphQLError(response, null, parseError instanceof Error ? parseError : new Error('Failed to parse response'));
        }
    }
    /**
     * Internal: Execute query with fetch (with deduplication and caching)
     *
     * Handles query execution with request deduplication and optional response caching.
     * If the same query is already in-flight, returns the existing promise instead of
     * making a duplicate request.
     *
     * Features:
     * - Request deduplication: Reuses in-flight requests with same key
     * - Response caching: Caches successful responses (if enabled)
     * - LRU eviction: Evicts oldest requests when limit is reached
     * - Error handling: Standardized error handling for all error types
     *
     * Cache strategy:
     * - Checks response cache first (if enabled)
     * - Checks pending requests for deduplication
     * - Caches successful responses (data without errors)
     * - Uses request key for both deduplication and caching
     *
     * @param query - GraphQL query string
     * @param variables - Query variables
     * @param signal - Optional abort signal
     * @returns Query result with data and/or errors
     */
    async _fetchQuery(query, variables, signal) {
        // Check response cache first (if enabled)
        if (this.enableResponseCache) {
            const cacheKey = this._getRequestKey('query', query, variables);
            const cached = this.responseCache.get(cacheKey);
            if (cached) {
                const now = Date.now();
                if (now - cached.timestamp < cached.ttl) {
                    return cached.data;
                }
                else {
                    // Remove expired entry
                    this.responseCache.delete(cacheKey);
                }
            }
        }
        // Create request key for deduplication
        const requestKey = this._getRequestKey('query', query, variables);
        // Check for in-flight request
        const pending = this.pendingRequests.get(requestKey);
        if (pending) {
            return pending;
        }
        // Ensure we don't exceed max pending requests
        // Map maintains insertion order, so we can use it directly for LRU
        this._evictOldestIfNeeded();
        // Create new request
        const request = this._executeFetch(query, variables, signal);
        // Store for deduplication
        // Map maintains insertion order automatically - no need for separate array
        this.pendingRequests.set(requestKey, request);
        try {
            const result = await request;
            // Cache successful query responses (if enabled)
            if (this.enableResponseCache && result.data && !result.errors) {
                this.responseCache.set(requestKey, {
                    data: result,
                    timestamp: Date.now(),
                    ttl: this.cacheTTL,
                });
            }
            return result;
        }
        finally {
            // Remove from pending requests
            // Map deletion maintains order of remaining entries
            this.pendingRequests.delete(requestKey);
        }
    }
    /**
     * Internal: Execute mutation with fetch
     * NOTE: Mutations are NOT deduplicated as they have side effects and should always execute
     */
    async _fetchMutation(mutation, variables, signal) {
        // Mutations always execute - no deduplication
        return this._executeFetch(mutation, variables, signal);
    }
    /**
     * Evict oldest pending requests if we exceed the limit
     * Uses Map's insertion order for O(1) LRU eviction
     */
    _evictOldestIfNeeded() {
        if (this.pendingRequests.size >= this.maxPendingRequests) {
            // Remove oldest requests (LRU eviction)
            // Map maintains insertion order, so first entry is oldest
            while (this.pendingRequests.size >= this.maxPendingRequests) {
                const firstKey = this.pendingRequests.keys().next().value;
                if (firstKey !== undefined) {
                    this.pendingRequests.delete(firstKey);
                }
                else {
                    break; // Safety break if Map is empty
                }
            }
        }
    }
    /**
     * Internal: Execute fetch request with timeout support
     * Checks abort only at critical points: before fetch and after async operations
     */
    async _executeFetch(operation, variables, signal) {
        // Check abort before starting network request
        this.checkAbort(signal);
        // Create timeout controller if timeout is configured
        let timeoutId;
        let timeoutController;
        let finalSignal = signal;
        if (this.timeout > 0) {
            timeoutController = new AbortController();
            timeoutId = setTimeout(() => {
                timeoutController.abort();
            }, this.timeout);
            // Combine signals if both exist
            if (signal) {
                const combinedController = new AbortController();
                const abort = () => combinedController.abort();
                signal.addEventListener('abort', abort);
                timeoutController.signal.addEventListener('abort', () => {
                    signal.removeEventListener('abort', abort);
                    combinedController.abort();
                });
                finalSignal = combinedController.signal;
            }
            else {
                finalSignal = timeoutController.signal;
            }
        }
        try {
            let response;
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
                    signal: finalSignal,
                    cache: 'no-cache', // Force re-validation with server to avoid stale cache, but allow caching after validation
                });
            }
            catch (error) {
                // Check for abort first
                if (isAbortError(error) || finalSignal?.aborted) {
                    throw new GraphQLAbortError();
                }
                // If it's already a GraphQL error, re-throw it
                if (error instanceof Error &&
                    (error.name === 'GraphQLRequestError' ||
                        error.name === 'GraphQLResponseError' ||
                        error.name === 'GraphQLNetworkError')) {
                    throw error;
                }
                // Wrap network errors
                throw createGraphQLError(null, null, error instanceof Error ? error : new Error('Network request failed'));
            }
            finally {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            }
            // Parse response using common helper (checks abort internally)
            const data = await this._parseResponse(response, finalSignal);
            return {
                data: data.data,
                errors: data.errors,
            };
        }
        catch (error) {
            // Check for abort first
            if (isAbortError(error) || finalSignal?.aborted) {
                throw new GraphQLAbortError();
            }
            // Re-throw GraphQL errors as-is
            if (error instanceof Error &&
                (error.name === 'GraphQLRequestError' ||
                    error.name === 'GraphQLResponseError' ||
                    error.name === 'GraphQLNetworkError' ||
                    error.name === 'GraphQLAbortError')) {
                throw error;
            }
            // Re-throw other errors
            throw error;
        }
    }
    /**
     * Generate a unique request key for deduplication
     * Uses stable stringification with sorted keys to prevent collisions
     */
    _getRequestKey(type, operation, variables) {
        // Create a stable key from operation and variables
        // Handle both typed and untyped variables
        const varsKey = variables && typeof variables === 'object' && !Array.isArray(variables)
            ? this._stableStringify(variables)
            : variables
                ? JSON.stringify(variables)
                : '';
        return `${type}:${operation}:${varsKey}`;
    }
    /**
     * Stable stringify that handles edge cases and creates consistent keys
     *
     * Creates a deterministic string representation of an object by sorting keys.
     * This ensures that objects with the same properties in different orders produce
     * the same cache key, improving cache hit rates.
     *
     * Performance optimizations:
     * - Uses string-based cache (Map) instead of WeakMap for better hit rates
     * - Fast path for simple objects (≤10 keys, primitive values only)
     * - LRU eviction when cache exceeds maxKeyCacheSize (1000 entries)
     * - Recursive key sorting with depth limit (10 levels) to prevent stack overflow
     *
     * Edge cases handled:
     * - Circular references: Falls back to object key count
     * - Large objects: Limits key processing to first 100 keys
     * - Deep nesting: Limits recursion depth to 10 levels
     * - Non-serializable values: Handles gracefully with fallback
     *
     * Cache strategy:
     * - Simple objects: Direct JSON.stringify for cache key
     * - Complex objects: Sorted keys prefix + full sorted stringification
     * - LRU eviction: Removes oldest entry when cache is full
     *
     * @param obj - Object to stringify
     * @returns Deterministic string representation of the object
     */
    _stableStringify(obj) {
        // Create a temporary key for cache lookup
        // For simple objects, try direct stringification first
        const objKeys = Object.keys(obj);
        const isSimpleObject = objKeys.length <= 10 && objKeys.every(key => {
            const val = obj[key];
            return val === null || val === undefined ||
                typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean';
        });
        let cacheKey;
        if (isSimpleObject) {
            // For simple objects, use a fast key generation
            try {
                cacheKey = JSON.stringify(obj);
            }
            catch {
                cacheKey = `simple:${objKeys.sort().join(',')}`;
            }
        }
        else {
            // For complex objects, use sorted keys
            cacheKey = `complex:${objKeys.sort().join(',')}`;
        }
        // Check cache first
        const cached = this.keyCache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }
        try {
            const sorted = this._sortObjectKeys(obj);
            const result = JSON.stringify(sorted);
            // Cache the result with size limit (LRU eviction)
            if (this.keyCache.size >= this.maxKeyCacheSize) {
                // Remove oldest entry (first in Map)
                const firstKey = this.keyCache.keys().next().value;
                if (firstKey !== undefined) {
                    this.keyCache.delete(firstKey);
                }
            }
            this.keyCache.set(cacheKey, result);
            return result;
        }
        catch (error) {
            // Fallback for circular references or other issues
            // Use a hash-like approach for problematic objects
            return `[object:${objKeys.length}]`;
        }
    }
    /**
     * Recursively sort object keys for stable stringification
     *
     * Recursively processes objects and arrays to create a sorted representation.
     * This ensures consistent output regardless of property order in the input object.
     *
     * Performance characteristics:
     * - O(n log n) for key sorting where n is number of keys
     * - O(d) where d is depth of nesting (limited to MAX_DEPTH)
     * - Limits processing to first 100 keys per object to prevent performance issues
     *
     * Safety limits:
     * - MAX_DEPTH: 10 levels of nesting (prevents stack overflow)
     * - MAX_KEYS: 100 keys per object (prevents processing large objects)
     * - Truncation marker: Adds '__truncated' field if keys are truncated
     *
     * Edge cases:
     * - Null/undefined: Returns as-is
     * - Primitives: Returns as-is
     * - Arrays: Recursively processes each element
     * - Objects: Sorts keys and recursively processes values
     * - Max depth exceeded: Returns string representation
     * - Max keys exceeded: Processes first 100 keys, adds truncation marker
     *
     * @param obj - Value to sort (can be any type)
     * @param depth - Current recursion depth (default: 0)
     * @returns Sorted representation of the input
     */
    _sortObjectKeys(obj, depth = 0) {
        // Limit recursion depth to prevent stack overflow (max 10 levels)
        const MAX_DEPTH = 10;
        if (depth > MAX_DEPTH) {
            // At max depth, return string representation to avoid infinite recursion
            return String(obj);
        }
        if (obj === null || obj === undefined) {
            return obj;
        }
        if (typeof obj !== 'object') {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map(item => this._sortObjectKeys(item, depth + 1));
        }
        const sorted = {};
        const keys = Object.keys(obj).sort();
        // For objects with many keys, limit processing to prevent performance issues
        const MAX_KEYS = 100;
        const keysToProcess = keys.length > MAX_KEYS ? keys.slice(0, MAX_KEYS) : keys;
        for (const key of keysToProcess) {
            sorted[key] = this._sortObjectKeys(obj[key], depth + 1);
        }
        // If we truncated, add a marker
        if (keys.length > MAX_KEYS) {
            sorted['__truncated'] = keys.length - MAX_KEYS;
        }
        return sorted;
    }
    /**
     * Clear all pending requests (useful for cleanup)
     */
    clearPendingRequests() {
        this.pendingRequests.clear();
    }
    /**
     * Clear response cache (useful for cache invalidation)
     */
    clearResponseCache() {
        this.responseCache.clear();
    }
    /**
     * Clear all caches (pending requests and response cache)
     */
    clearAllCaches() {
        this.clearPendingRequests();
        this.clearResponseCache();
        this.keyCache.clear();
    }
    /**
     * Cleanup and destroy the client
     * Stops all intervals and clears all caches
     */
    destroy() {
        this.stopCacheCleanup();
        this.clearAllCaches();
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = undefined;
        }
        this.batchQueue = [];
    }
    /**
     * Batch a query request (if batching is enabled)
     * Prevents race conditions by ensuring only one batch timer exists
     */
    _batchQuery(query, variables, signal) {
        return new Promise((resolve, reject) => {
            // Add to batch queue
            this.batchQueue.push({
                operation: query,
                variables: variables,
                resolve: resolve,
                reject,
                signal,
            });
            // Check if we should flush immediately (max batch size reached)
            if (this.batchQueue.length >= this.maxBatchSize) {
                // Clear any existing timer before flushing
                if (this.batchTimer) {
                    clearTimeout(this.batchTimer);
                    this.batchTimer = undefined;
                }
                this._flushBatch();
                return;
            }
            // Schedule batch flush only if no timer exists and not currently flushing
            if (!this.batchTimer && !this.batchFlushing) {
                this.batchTimer = setTimeout(() => {
                    this.batchTimer = undefined;
                    this._flushBatch();
                }, this.batchDelay);
            }
        });
    }
    /**
     * Flush the current batch of requests
     *
     * This method handles batching multiple GraphQL queries into a single HTTP request.
     * It prevents race conditions by using a flushing flag and ensures proper error handling.
     *
     * Edge cases handled:
     * - Concurrent batch flushes: Uses `batchFlushing` flag to prevent multiple simultaneous flushes
     * - Aborted requests: Filters out aborted requests before sending batch
     * - Response validation: Validates that batch response is an array and matches request length
     * - Error handling: Uses standardized error handling for all error types
     * - Queue continuation: Automatically schedules next batch if queue has remaining items
     *
     * Performance characteristics:
     * - O(n) where n is batch size for request processing
     * - O(n) for response validation and promise resolution
     * - Uses combined AbortSignal for efficient signal handling
     *
     * @throws {GraphQLAbortError} If any request in the batch is aborted
     * @throws {GraphQLRequestError} If batch response format is invalid
     * @throws {GraphQLNetworkError} If network request fails
     */
    async _flushBatch() {
        // Prevent concurrent batch flushes
        if (this.batchFlushing) {
            return;
        }
        if (this.batchQueue.length === 0) {
            return;
        }
        // Set flushing flag and clear the timer
        this.batchFlushing = true;
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = undefined;
        }
        // Get current batch and clear queue
        const batch = this.batchQueue.splice(0, this.maxBatchSize);
        if (batch.length === 0) {
            this.batchFlushing = false;
            return;
        }
        // Create batched request
        const operations = batch.map((item, index) => ({
            query: item.operation,
            variables: item.variables || {},
        }));
        // Check if any request is aborted
        const abortedIndices = batch
            .map((item, index) => (item.signal?.aborted ? index : -1))
            .filter(index => index !== -1);
        // Reject aborted requests
        abortedIndices.forEach(index => {
            batch[index].reject(new GraphQLAbortError());
        });
        // Remove aborted requests from batch
        const activeBatch = batch.filter((_, index) => !abortedIndices.includes(index));
        const activeOperations = operations.filter((_, index) => !abortedIndices.includes(index));
        if (activeBatch.length === 0) {
            return;
        }
        // Combine abort signals if any
        let combinedSignal;
        const signals = activeBatch.map(item => item.signal).filter((s) => s !== undefined);
        if (signals.length > 0) {
            const combinedController = new AbortController();
            signals.forEach(signal => {
                if (signal.aborted) {
                    combinedController.abort();
                }
                else {
                    signal.addEventListener('abort', () => combinedController.abort());
                }
            });
            combinedSignal = combinedController.signal;
        }
        try {
            // Execute batched request
            const response = await fetch(`${this.baseUrl}/graphql`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.apiKey && { ApiKey: this.apiKey }),
                },
                body: JSON.stringify({
                    queries: activeOperations,
                }),
                signal: combinedSignal,
                cache: 'no-cache', // Force re-validation with server to avoid stale cache, but allow caching after validation
            });
            // Parse batched response
            // Note: Batched responses may have different format, so we handle it separately
            if (!response.ok) {
                throw createGraphQLError(response, null);
            }
            const contentType = response.headers.get('content-type');
            if (!contentType || (!contentType.includes('application/json') && !contentType.includes('application/graphql-response+json'))) {
                const text = await response.text();
                throw createGraphQLError(response, null, new Error(`Unexpected content type: ${contentType}. Response: ${text.substring(0, 200)}`));
            }
            let results;
            try {
                const responseData = await response.json();
                // Validate batch response format
                if (!Array.isArray(responseData)) {
                    throw createGraphQLError(response, null, new Error(`Invalid batch response format: expected array, got ${typeof responseData}`));
                }
                results = responseData;
                // Validate response length matches request length
                if (results.length !== activeOperations.length) {
                    throw createGraphQLError(response, null, new Error(`Batch response length mismatch: expected ${activeOperations.length}, got ${results.length}`));
                }
            }
            catch (parseError) {
                // Check for abort first
                if (isAbortError(parseError) || combinedSignal?.aborted) {
                    throw new GraphQLAbortError();
                }
                // If it's already a GraphQL error, re-throw it
                if (parseError instanceof Error &&
                    (parseError.name === 'GraphQLRequestError' ||
                        parseError.name === 'GraphQLResponseError' ||
                        parseError.name === 'GraphQLNetworkError')) {
                    throw parseError;
                }
                // Wrap parse errors
                throw createGraphQLError(response, null, parseError instanceof Error ? parseError : new Error('Failed to parse batch response'));
            }
            // Resolve each promise with its corresponding result
            // Results are guaranteed to be in same order as requests
            activeBatch.forEach((item, index) => {
                if (item.signal?.aborted) {
                    item.reject(new GraphQLAbortError());
                }
                else if (results[index]) {
                    item.resolve(results[index]);
                }
                else {
                    item.reject(new Error(`Missing result at index ${index} in batch response`));
                }
            });
        }
        catch (error) {
            // Standardized error handling - reject all promises in the batch
            activeBatch.forEach(item => {
                // Use standardized error handling
                try {
                    this.handleError(error, item.signal);
                }
                catch (handledError) {
                    item.reject(handledError);
                }
            });
        }
        finally {
            // Always clear flushing flag
            this.batchFlushing = false;
            // If there are more items in queue, schedule next flush
            if (this.batchQueue.length > 0 && !this.batchTimer) {
                this.batchTimer = setTimeout(() => {
                    this.batchTimer = undefined;
                    this._flushBatch();
                }, this.batchDelay);
            }
        }
    }
}
//# sourceMappingURL=client.js.map
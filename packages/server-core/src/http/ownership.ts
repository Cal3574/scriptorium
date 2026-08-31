import { ResourceNotFoundException } from './problem.exception.js';

/**
 * The one authorization primitive. Given a row that may be `undefined` (not
 * found) and the caller's local user id, returns the row when the caller owns
 * it and throws an identical `404` otherwise - whether the row is missing or
 * belongs to someone else. Callers pass the resource-specific `code`
 * (`book_not_found`, ...) so the client still gets a precise machine string.
 */
export function assertOwnership<T extends { userId: string }>(
  resource: T | undefined | null,
  userId: string,
  code = 'not_found',
): T {
  if (!resource || resource.userId !== userId) {
    throw new ResourceNotFoundException(code);
  }
  return resource;
}

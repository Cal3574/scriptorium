import { assertOwnership } from './ownership.js';
import { ResourceNotFoundException } from './problem.exception.js';

describe('assertOwnership', () => {
  const owner = 'user-1';

  it('returns the resource when the caller owns it', () => {
    const row = { userId: owner, title: 'x' };
    expect(assertOwnership(row, owner)).toBe(row);
  });

  it('throws an identical 404 for a missing resource and one owned by another', () => {
    const missing = catchError(() =>
      assertOwnership(undefined, owner, 'book_not_found'),
    );
    const foreign = catchError(() =>
      assertOwnership({ userId: 'user-2' }, owner, 'book_not_found'),
    );

    expect(missing).toBeInstanceOf(ResourceNotFoundException);
    expect(foreign).toBeInstanceOf(ResourceNotFoundException);
    expect((missing as ResourceNotFoundException).getStatus()).toBe(404);
    expect((missing as ResourceNotFoundException).code).toBe('book_not_found');
    expect((foreign as ResourceNotFoundException).code).toBe('book_not_found');
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
    throw new Error('expected a throw');
  } catch (error) {
    return error;
  }
}

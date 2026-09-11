import { useOutletContext } from 'react-router';
import type { BookDetailDto } from '@scriptorium/contracts';

// The reader layout loads `BookDetailDto` once and hands it to the Overview and
// chapter screens through the router outlet context, so neither refetches.
export interface ReaderContext {
  book: BookDetailDto;
}

export function useReaderBook(): BookDetailDto {
  return useOutletContext<ReaderContext>().book;
}

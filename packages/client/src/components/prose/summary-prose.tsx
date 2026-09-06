import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

// The single place `react-markdown` is rendered (scriptorium#62). Every book
// summary, chapter deep-dive and query answer goes through here so they all
// get the one hand-rolled `.prose` treatment (index.css) - the 68ch measure,
// Fraunces headings, mono code, accent quotes and links, hairline tables -
// in both themes. `remark-gfm` enables tables, strikethrough and task lists.
export function SummaryProse({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div className={cn('prose', className)}>
      <Markdown remarkPlugins={[remarkGfm]}>{markdown}</Markdown>
    </div>
  );
}

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

// The source text behind an answer (#54 inventory; user story 50). One
// collapsible section - collapsed by default so it never buries the answer -
// holding every retrieved chunk: a mono `[n] book - chapter` header and the
// chunk verbatim in a `blockquote`, so the reader can check the answer against
// what it was actually given.
export type PassageRef = {
  key: string;
  marker: number;
  bookTitle: string;
  chapterTitle: string;
  chunkText: string;
};

export function RetrievedPassages({ passages }: { passages: PassageRef[] }) {
  return (
    <Accordion
      type="single"
      collapsible
      className="border-border bg-card rounded-lg border px-4"
    >
      <AccordionItem value="passages">
        <AccordionTrigger className="text-sm font-medium hover:no-underline">
          Retrieved passages
          <span className="text-muted-foreground ml-2 font-mono text-xs">
            {passages.length}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <ul data-passages className="m-0 list-none space-y-4 p-0">
            {passages.map((p) => (
              <li key={p.key}>
                <p className="text-muted-foreground m-0 font-mono text-xs">
                  [{p.marker}] {p.bookTitle} - {p.chapterTitle}
                </p>
                <blockquote className="border-border text-muted-foreground mt-1 border-l-2 pl-3 text-sm">
                  {p.chunkText}
                </blockquote>
              </li>
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

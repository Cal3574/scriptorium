import type { ChapterDto } from '@scriptorium/contracts';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { SummaryProse } from '@/components/prose/summary-prose';

// The chapter list on BookDetail (#54, user story 39): every chapter in
// `chapterIndex` order, its deep-dive behind a shadcn `Accordion` set to
// `type="multiple"` so the reader can open several at once. The trigger is the
// chapter heading in Fraunces. A chapter whose `summary` is still null gets a
// disabled trigger marked "Not generated yet" - there is nothing to open.
export function ChapterAccordion({ chapters }: { chapters: ChapterDto[] }) {
  return (
    <Accordion
      type="multiple"
      className="border-border bg-card rounded-lg border px-4"
    >
      {chapters.map((chapter) => {
        const heading = chapter.title ?? `Chapter ${chapter.chapterIndex + 1}`;
        const ready = chapter.summary != null;
        return (
          <AccordionItem key={chapter.id} value={chapter.id}>
            <AccordionTrigger
              disabled={!ready}
              className="font-serif text-[15px] font-medium hover:no-underline"
            >
              <span className="flex flex-1 items-baseline justify-between gap-3">
                <span
                  className={ready ? undefined : 'text-muted-foreground'}
                >
                  {heading}
                </span>
                {!ready && (
                  <span className="text-muted-foreground font-sans text-xs italic">
                    Not generated yet
                  </span>
                )}
              </span>
            </AccordionTrigger>
            {ready && (
              <AccordionContent>
                <SummaryProse markdown={chapter.summary as string} />
              </AccordionContent>
            )}
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}

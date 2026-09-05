// The numbered sources an answer drew on (#54 inventory; user story 49). An
// ordered list whose `[n]` markers are set in mono - matching the `[n]` handles
// the answer text cites by - followed by the book and chapter in prose. The
// caller passes the markers explicitly so a persisted history snapshot (no
// `marker` field) and a live stream can both feed this component.
export type CitationRef = {
  key: string;
  marker: number;
  bookTitle: string;
  chapterTitle: string;
};

export function CitationList({ citations }: { citations: CitationRef[] }) {
  return (
    <ol data-citations className="m-0 list-none space-y-1 p-0 text-sm">
      {citations.map((c) => (
        <li key={c.key} className="flex gap-2">
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            [{c.marker}]
          </span>
          <span>
            {c.bookTitle} - {c.chapterTitle}
          </span>
        </li>
      ))}
    </ol>
  );
}

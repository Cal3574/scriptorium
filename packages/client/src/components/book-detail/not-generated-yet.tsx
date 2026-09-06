// The muted placeholder shown where a book or chapter summary will land once
// its pipeline stage completes (#54 inventory, user story 40). A null summary
// is a normal not-yet state, not an error - so it reads calm, not red.
export function NotGeneratedYet({ what = 'summary' }: { what?: string }) {
  return (
    <p className="text-muted-foreground m-0 text-sm italic">
      No {what} generated yet.
    </p>
  );
}

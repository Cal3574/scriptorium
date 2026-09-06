import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// The Ask screen's question box (#54 inventory; user story 45): one Fraunces
// prompt, a shadcn `Textarea`, and a single Ask `Button`. The button reads
// "Thinking..." and is disabled while the answer streams, and is disabled on an
// empty question so the reader cannot fire a blank query. Submitting is the
// only action - Enter in the textarea still inserts a newline.
export function QuestionForm({
  question,
  onQuestionChange,
  onSubmit,
  busy,
}: {
  question: string;
  onQuestionChange: (next: string) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
    <form
      className="mb-8"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Textarea
        rows={3}
        value={question}
        disabled={busy}
        aria-label="question"
        placeholder="What do these authors say about..."
        onChange={(e) => onQuestionChange(e.target.value)}
      />
      <Button
        type="submit"
        className="mt-3"
        disabled={busy || !question.trim()}
      >
        {busy ? 'Thinking...' : 'Ask'}
      </Button>
    </form>
  );
}

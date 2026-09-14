import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ThinkingDots } from '@/components/ai/thinking-dots';

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
  disabled = false,
}: {
  question: string;
  onQuestionChange: (next: string) => void;
  onSubmit: () => void;
  busy: boolean;
  // Separate from `busy`: a spent quota (the chat widget's proactive
  // limit-reached banner, #163) disables the form without claiming the
  // question is mid-flight, so it never shows the "Thinking..." label.
  disabled?: boolean;
}) {
  const isDisabled = busy || disabled;
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
        disabled={isDisabled}
        aria-label="question"
        placeholder="What do these authors say about..."
        onChange={(e) => onQuestionChange(e.target.value)}
      />
      <Button
        type="submit"
        className="mt-3 cursor-pointer"
        disabled={isDisabled || !question.trim()}
      >
        {busy ? (
          <span className="inline-flex items-center gap-1.5">
            Thinking
            <ThinkingDots />
          </span>
        ) : (
          'Ask'
        )}
      </Button>
    </form>
  );
}

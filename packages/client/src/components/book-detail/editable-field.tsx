import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Inline edit for one metadata field on BookDetail (#54; user story 41). The
// read state shows the current value (or a muted placeholder when empty) with
// a quiet "Edit" control; editing swaps in a text `Input` with Save / Cancel
// in place - no modal. A `nullable` field (author) saved empty sends an
// explicit `null` to clear it; a non-nullable field (title) refuses an empty
// save with an inline error.
export function EditableField({
  label,
  value,
  placeholder,
  nullable,
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  nullable: boolean;
  onSave: (next: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraft(value ?? '');
    setError(null);
    setEditing(true);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed && !nullable) {
      setError('A title is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed ? trimmed : null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className={value ? 'text-foreground' : 'text-muted-foreground'}
        >
          {value || placeholder}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={start}
          aria-label={`Edit ${label}`}
        >
          Edit
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input
        type="text"
        value={draft}
        disabled={busy}
        aria-label={`${label} input`}
        className="h-8 w-64"
        onChange={(e) => setDraft(e.target.value)}
      />
      <Button
        type="button"
        size="xs"
        onClick={() => void save()}
        disabled={busy}
      >
        {busy ? 'Saving...' : 'Save'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setEditing(false)}
        disabled={busy}
      >
        Cancel
      </Button>
      {error && (
        <span role="alert" className="text-status-failed text-xs">
          {error}
        </span>
      )}
    </span>
  );
}

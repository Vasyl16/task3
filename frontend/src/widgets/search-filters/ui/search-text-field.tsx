import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { TextField } from '../../../shared/ui';

const searchTextSchema = z.object({
  q: z.string().max(200, 'Search is too long'),
});
type SearchTextValues = z.infer<typeof searchTextSchema>;

const DEBOUNCE_MS = 400;

// The free-text query is the one field in this filter bar that changes
// on every keystroke — everything else (Select/Checkbox) only fires
// onChange once per selection. Without debouncing, each keystroke would
// push a new URL (HomePage keeps `query` in the URL — see home-page.tsx)
// and fire a new search request. Built with React Hook Form + Zod like
// every other form in this codebase (see frontend.md), even though
// there's no submit button: "submitting" here is just calling
// onDebouncedChange once the user pauses, instead of on every character.
export function SearchTextField({
  value,
  onDebouncedChange,
}: {
  value: string;
  onDebouncedChange: (q: string | undefined) => void;
}) {
  const {
    register,
    watch,
    formState: { errors },
  } = useForm<SearchTextValues>({
    resolver: zodResolver(searchTextSchema),
    // Keeps the field in sync with external changes to `value` (e.g. the
    // browser back/forward button rewriting the URL) — RHF only resets
    // when the incoming value actually differs, so this is a no-op for
    // the loop-back from our own debounced onDebouncedChange call below.
    values: { q: value },
  });

  const q = watch('q');

  // A ref, not a dependency: onDebouncedChange is a fresh closure on
  // every parent render (HomePage's updateQuery isn't memoized), and
  // depending on it directly would restart the debounce timer on
  // unrelated parent re-renders.
  const onDebouncedChangeRef = useRef(onDebouncedChange);
  onDebouncedChangeRef.current = onDebouncedChange;

  useEffect(() => {
    if (errors.q) return;
    const timeout = setTimeout(() => {
      onDebouncedChangeRef.current(q.trim() || undefined);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [q, errors.q]);

  return (
    <TextField
      label="Search"
      placeholder="Search products…"
      error={errors.q?.message}
      {...register('q')}
    />
  );
}

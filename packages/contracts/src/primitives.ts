import { z } from 'zod';

// Shared primitive schemas reused across every DTO. Kept in one place so the
// wire format for an id or a timestamp is defined exactly once.

// All primary keys are Postgres `uuid` (see the data-model spec).
export const uuid = z.string().uuid();

// Timestamps cross the wire as ISO-8601 strings in UTC (the JSON encoding of a
// `timestamptz`), never as epoch numbers or `Date` instances.
export const isoTimestamp = z.string().datetime({ offset: true });

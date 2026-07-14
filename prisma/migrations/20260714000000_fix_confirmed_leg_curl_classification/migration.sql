-- Correct two confirmed imported leg-curl catalog rows without merging their
-- separate exercise histories. The stable IDs and old-state predicate keep
-- this migration bounded and idempotent; similarly named user exercises are
-- intentionally left untouched for manual review.
UPDATE "Exercise"
SET "muscleGroup" = 'HAMSTRINGS'
WHERE "id" IN (
  '5d93e1da-e9c8-4789-a0db-5bb5c155469e',
  'b6b7f824-e33d-4b53-81c4-c9ee82f015ef'
)
AND "muscleGroup" = 'BICEPS'
AND lower("name") IN (
  lower('Leg Curls on Leg Extension Machine · Machine'),
  lower('Lying Leg Curls · Machine')
);

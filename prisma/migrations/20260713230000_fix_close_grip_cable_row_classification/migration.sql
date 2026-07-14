-- Correct the imported ReGYM/Alpha catalog row that was labeled as triceps.
-- This is a seated cable row, so its primary group and equipment metadata must
-- match the movement before MCP volume summaries consume it.
UPDATE "Exercise"
SET
  "muscleGroup" = 'BACK_THICKNESS',
  "category" = 'COMPOUND',
  "equipmentType" = 'CABLE'
WHERE lower("name") IN (
  lower('Rows with Close Grip'),
  lower('Rows with Close Grip · Cable')
)
AND "muscleGroup" = 'TRICEPS';

-- CoachSession.prompt now stores only non-sensitive audit metadata. Existing
-- legacy prompts may contain the complete structured coach payload, so redact
-- every historical row during deployment.
UPDATE "CoachSession"
SET "prompt" = '{"version":1,"kind":"weekly-debrief","source":"legacy-redacted"}';

-- Preserve historical fractional RIR values (for example 0.5) during legacy
-- production cutover. Existing integer values convert losslessly.
ALTER TABLE "Set"
ALTER COLUMN "rir" TYPE DOUBLE PRECISION
USING "rir"::DOUBLE PRECISION;

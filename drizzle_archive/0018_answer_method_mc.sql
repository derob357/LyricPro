-- 0018_answer_method_mc.sql
-- Extend the answer_method enum to include "mc" (multiple-choice) so that
-- submitAnswer can record when a player picked from rendered options.
-- ALTER TYPE ... ADD VALUE is non-transactional in Postgres and cannot run
-- inside an explicit transaction, so this file must be applied outside of
-- BEGIN/COMMIT — use the apply script which skips transaction wrapping.
ALTER TYPE answer_method ADD VALUE IF NOT EXISTS 'mc';

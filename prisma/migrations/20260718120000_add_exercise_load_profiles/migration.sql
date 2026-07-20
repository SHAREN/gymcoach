ALTER TABLE "Exercise"
ADD COLUMN "catalogOrigin" VARCHAR(64),
ADD COLUMN "loadProfile" JSONB NOT NULL DEFAULT '{"version":1,"algorithmVersion":"2026-07-18-multi-muscle-v1","classification":"UNCLASSIFIED","provenance":"UNCLASSIFIED","confidence":"UNKNOWN","primaryMuscles":{"state":"UNKNOWN","entries":[]},"secondaryMuscles":{"state":"UNKNOWN","entries":[]},"movementPatterns":{"state":"UNKNOWN","entries":[]},"fatigueTags":{"state":"UNKNOWN","entries":[]},"jointStress":{"state":"UNKNOWN","entries":[]}}'::jsonb;

-- Preserve the legacy primary-muscle evidence for every existing row without
-- changing the Exercise id or any relation. All unmodeled dimensions remain
-- explicitly unknown rather than being normalized to zero participation.
UPDATE "Exercise"
SET "loadProfile" = jsonb_build_object(
  'version', 1,
  'algorithmVersion', '2026-07-18-multi-muscle-v1',
  'classification', 'LEGACY_PRIMARY_ONLY',
  'provenance', 'LEGACY_PRIMARY_MIGRATION',
  'confidence', CASE WHEN "muscleGroup" = 'OTHER' THEN 'UNKNOWN' ELSE 'LOW' END,
  'primaryMuscles', CASE
    WHEN "muscleGroup" = 'OTHER' THEN jsonb_build_object('state', 'UNKNOWN', 'entries', '[]'::jsonb)
    ELSE jsonb_build_object(
      'state', 'KNOWN',
      'entries', jsonb_build_array(jsonb_build_object(
        'muscleGroup', "muscleGroup"::text,
        'provenance', 'LEGACY_PRIMARY_MIGRATION',
        'confidence', 'LOW'
      ))
    )
  END,
  'secondaryMuscles', jsonb_build_object('state', 'UNKNOWN', 'entries', '[]'::jsonb),
  'movementPatterns', jsonb_build_object('state', 'UNKNOWN', 'entries', '[]'::jsonb),
  'fatigueTags', jsonb_build_object('state', 'UNKNOWN', 'entries', '[]'::jsonb),
  'jointStress', jsonb_build_object('state', 'UNKNOWN', 'entries', '[]'::jsonb)
);

-- A name is not proof of catalog origin. Backfill the server-owned marker only
-- when the complete stored row matches the immutable system-catalog snapshot
-- that existed when this migration was authored. Any mismatch fails closed as
-- legacy/custom data and keeps every unmodeled dimension unknown.
WITH canonical_catalog(
  name,
  muscle_group,
  category,
  default_rest_sec,
  uses_bodyweight,
  notes,
  equipment_type
) AS (
  VALUES
    ('Barbell bench press', 'CHEST', 'COMPOUND', 150, false, 'Bar in the heel of the palm, wrist aligned with the forearm. Elbows at 45 degrees from the torso. Touch the chest.', 'OTHER'),
    ('Incline dumbbell press (30 deg)', 'CHEST', 'COMPOUND', 120, false, 'Bench at 30 degrees. Tempo 3-0-1-0. Do not lock the elbows at the top. Upper-chest focus.', 'OTHER'),
    ('Pec deck (or cable fly)', 'CHEST', 'ISOLATION', 75, false, 'Elbows 5 to 10 degrees below the shoulder line. Driven by the elbows. Pause at the stretch and at the contraction.', 'OTHER'),
    ('Pronated pull-ups (weighted if possible)', 'BACK_WIDTH', 'COMPOUND', 120, true, 'Pronated grip, shoulder width + 10 cm. Strict tempo. Pull with the elbows toward the hips. Add load once 4x10 is reached.', 'OTHER'),
    ('Lat pulldown (wide grip)', 'BACK_WIDTH', 'COMPOUND', 120, false, 'Wide pronated grip. Pull to the collarbones, shoulder blades down. Torso slightly leaned back.', 'OTHER'),
    ('Bent-over barbell row', 'BACK_THICKNESS', 'COMPOUND', 120, false, 'Torso 30 to 45 degrees, flat back. Pull toward the navel. Elbows close to the body.', 'OTHER'),
    ('Seated cable row (close handles)', 'BACK_THICKNESS', 'COMPOUND', 90, false, 'Parallel handles. Pull toward the navel. Squeeze the shoulder blades. Elbows close to the body.', 'OTHER'),
    ('Seated dumbbell overhead press', 'SHOULDERS_FRONT', 'COMPOUND', 120, false, 'Bench at 90 degrees with a backrest. No lower-back arch. Lower down to the ears.', 'OTHER'),
    ('Cable lateral raises', 'SHOULDERS_LATERAL', 'ISOLATION', 60, false, 'Cable in front of the body. Elbow slightly bent. Lead with the elbow. Stop at shoulder height. Slow descent.', 'OTHER'),
    ('Machine rear delt fly', 'SHOULDERS_REAR', 'ISOLATION', 60, false, 'Reverse pec deck. Driven by the elbows toward the back. Palms facing the floor. Squeeze 1s.', 'OTHER'),
    ('EZ-bar curl', 'BICEPS', 'ISOLATION', 75, false, 'No swinging. Squeeze 1s at the top. Elbows close to the body.', 'OTHER'),
    ('Incline dumbbell curl (bench 60 deg)', 'BICEPS', 'ISOLATION', 75, false, 'Bench at 60 degrees. Elbows behind the torso, fixed. Supinate on the way up. Full stretch at the bottom (Maeo 2021).', 'OTHER'),
    ('Machine dips or parallel bars', 'TRICEPS', 'COMPOUND', 75, true, 'Vertical torso for triceps focus. On an assisted machine, log the machine assistance setting as the added load.', 'OTHER'),
    ('Triceps pushdown (rope)', 'TRICEPS', 'ISOLATION', 60, false, 'Elbows pinned to the body. Spread the rope at the bottom. Do not snap the elbow into lockout (95% max extension).', 'OTHER'),
    ('Machine squat (or Hack squat)', 'QUADS', 'COMPOUND', 150, false, 'Depth to parallel thighs. Controlled 3s descent.', 'OTHER'),
    ('Leg extension', 'QUADS', 'ISOLATION', 75, false, 'Pause 1s at the top. Neutral feet.', 'OTHER'),
    ('Walking lunges with dumbbells', 'QUADS', 'COMPOUND', 90, false, 'Knee to 1 cm from the floor, no bounce.', 'OTHER'),
    ('Dumbbell Romanian Deadlift', 'HAMSTRINGS', 'COMPOUND', 120, false, 'Push the hips back, flat back. Knees slightly bent. Maximal hamstring stretch.', 'OTHER'),
    ('Seated leg curl', 'HAMSTRINGS', 'ISOLATION', 75, false, 'Pause 1s at the contraction. Full range of motion.', 'OTHER'),
    ('Barbell hip thrust (or machine)', 'GLUTES', 'COMPOUND', 120, false, 'Pause 1s at the top, neutral neck. Lock the glutes at the top.', 'OTHER'),
    ('Hip adduction machine', 'QUADS', 'ISOLATION', 60, false, 'Pause 1s at the contraction.', 'OTHER'),
    ('Standing calf raise (or machine)', 'CALVES', 'ISOLATION', 60, false, 'Gastrocnemius (legs straight). Full range, pause 1s at the bottom. No bounce.', 'OTHER'),
    ('Seated calf raise machine', 'CALVES', 'ISOLATION', 60, false, 'Soleus (legs bent 90 degrees). Pause at the bottom stretch. Tempo 3-1-1-1. No bounce.', 'OTHER'),
    ('Cable crunch (kneeling)', 'ABS', 'ISOLATION', 60, false, 'Hips locked. Roll the spine. Bring the ribs toward the pelvis.', 'OTHER'),
    ('Hanging leg raises', 'ABS', 'ISOLATION', 60, true, 'Control 2s on the way down. No swinging.', 'OTHER'),
    ('Plank + side plank', 'ABS', 'ISOLATION', 45, true, 'Core stability. 1 round as a finisher.', 'OTHER'),
    ('Flat dumbbell bench press', 'CHEST', 'COMPOUND', 120, false, 'Dumbbells let each side work independently. Wrists stacked over the elbows. Touch at chest level, do not lock out hard.', 'OTHER'),
    ('Machine chest press', 'CHEST', 'COMPOUND', 90, false, 'Handles at mid-chest height. Drive through the chest, stop just short of lockout. Great for pushing close to failure safely.', 'OTHER'),
    ('Neutral-grip lat pulldown', 'BACK_WIDTH', 'COMPOUND', 120, false, 'Palms facing, shoulder-width handle. Pull to the upper chest, drive the elbows down and back.', 'OTHER'),
    ('Straight-arm cable pulldown', 'BACK_WIDTH', 'ISOLATION', 75, false, 'Arms nearly straight, slight elbow bend held fixed. Drive the bar to the thighs with the lats. Big stretch at the top.', 'OTHER'),
    ('Chest-supported machine row', 'BACK_THICKNESS', 'COMPOUND', 90, false, 'Chest pad removes lower-back fatigue. Row to the torso, squeeze the shoulder blades, control the stretch.', 'OTHER'),
    ('Single-arm dumbbell row', 'BACK_THICKNESS', 'COMPOUND', 90, false, 'Knee and hand on the bench, flat back. Pull toward the hip, elbow close to the body. Full stretch at the bottom.', 'OTHER'),
    ('Standing barbell overhead press', 'SHOULDERS_FRONT', 'COMPOUND', 150, false, 'Brace the core, glutes tight, no excessive arch. Bar travels over the mid-foot. Lock out with the head through.', 'OTHER'),
    ('Dumbbell lateral raise', 'SHOULDERS_LATERAL', 'ISOLATION', 60, false, 'Slight forward lean, elbows soft. Lead with the elbows to shoulder height. Control the descent, no swinging.', 'OTHER'),
    ('Face pull (rope)', 'SHOULDERS_REAR', 'ISOLATION', 60, false, 'Cable at face height. Pull the rope apart toward the forehead, externally rotate. Rear delts and upper back.', 'OTHER'),
    ('Standing cable curl (straight bar)', 'BICEPS', 'ISOLATION', 60, false, 'Constant cable tension through the range. Elbows pinned. Squeeze 1s at the top, no swinging.', 'OTHER'),
    ('Concentration curl', 'BICEPS', 'ISOLATION', 60, false, 'Seated, elbow braced on the inner thigh. Strict, full contraction. High peak-contraction tension.', 'OTHER'),
    ('Barbell wrist curl', 'FOREARMS', 'ISOLATION', 60, false, 'Forearms on the thighs or a bench, palms up. Let the bar roll to the fingers, then curl the wrists up. Full range, no momentum.', 'OTHER'),
    ('Reverse EZ-bar curl', 'FOREARMS', 'ISOLATION', 60, false, 'Pronated (palms down) grip. Targets the brachioradialis and wrist extensors. Lighter load, strict tempo.', 'OTHER'),
    ('Hammer curl (dumbbell)', 'BICEPS', 'ISOLATION', 60, false, 'Neutral grip throughout. Emphasizes the brachialis and brachioradialis. Elbows fixed, no swinging.', 'OTHER'),
    ('Close-grip bench press', 'TRICEPS', 'COMPOUND', 120, false, 'Grip just inside shoulder width. Elbows tucked. Bar to the lower chest. Triceps-biased pressing.', 'OTHER'),
    ('Overhead cable triceps extension', 'TRICEPS', 'ISOLATION', 60, false, 'Rope from a low or high pulley, facing away. Long-head stretch overhead. Extend fully, keep the elbows in.', 'OTHER'),
    ('EZ-bar skull crusher', 'TRICEPS', 'ISOLATION', 75, false, 'Lower to the forehead or behind the head for more stretch. Elbows pointing up, kept narrow. Controlled descent.', 'OTHER'),
    ('Leg press (45 deg)', 'QUADS', 'COMPOUND', 150, false, 'Feet mid-platform, shoulder width. Lower until the knees reach the chest without the lower back rounding. Do not lock out hard.', 'OTHER'),
    ('Goblet squat', 'QUADS', 'COMPOUND', 120, false, 'Hold a dumbbell at the chest. Upright torso, elbows inside the knees at the bottom. Great for learning depth.', 'OTHER'),
    ('Bulgarian split squat', 'QUADS', 'COMPOUND', 90, false, 'Rear foot elevated. Most weight on the front leg, vertical shin bias for quads. Control the descent.', 'OTHER'),
    ('Lying leg curl', 'HAMSTRINGS', 'ISOLATION', 75, false, 'Hips pinned to the pad. Curl fully, pause 1s at the contraction, control the negative. No hip lift.', 'OTHER'),
    ('Cable glute kickback', 'GLUTES', 'ISOLATION', 60, false, 'Ankle strap on a low pulley. Hinge slightly, drive the heel back and up. Squeeze the glute at the top, no lower-back arch.', 'OTHER'),
    ('Back extension (hyperextension)', 'LOWER_BACK', 'ISOLATION', 60, true, 'Hips on the pad. Round and extend through the spine, or stay rigid to bias the glutes. Add a plate for load.', 'OTHER'),
    ('Barbell good morning', 'LOWER_BACK', 'COMPOUND', 120, false, 'Bar on the upper back. Hinge at the hips with a flat back, soft knees. Light load, feel the spinal erectors and hamstrings.', 'OTHER'),
    ('Machine crunch', 'ABS', 'ISOLATION', 60, false, 'Flex the spine against the resistance, ribs toward the pelvis. Controlled tempo, pause at the contraction.', 'OTHER'),
    ('Running', 'OTHER', 'CARDIO', 60, false, 'Steady pace you could hold a conversation at, or intervals. Log the time and distance.', 'OTHER'),
    ('Rowing machine', 'OTHER', 'CARDIO', 60, false, 'Drive with the legs, then swing the hips, then pull. Log the time and distance.', 'OTHER'),
    ('Cycling', 'OTHER', 'CARDIO', 60, false, 'Outdoor or stationary bike. Log the time and distance.', 'OTHER'),
    ('Jump rope', 'OTHER', 'CARDIO', 60, false, 'Light on the feet, elbows close, turn from the wrists. Log the time.', 'OTHER')
)
UPDATE "Exercise" AS exercise
SET "catalogOrigin" = 'SYSTEM_DEFAULT_V1'
FROM canonical_catalog AS catalog
WHERE exercise."name" = catalog.name
  AND exercise."muscleGroup"::text = catalog.muscle_group
  AND exercise."category"::text = catalog.category
  AND exercise."defaultRestSec" = catalog.default_rest_sec
  AND exercise."usesBodyweight" = catalog.uses_bodyweight
  AND exercise."notes" IS NOT DISTINCT FROM catalog.notes
  AND exercise."equipmentType"::text IN (
    catalog.equipment_type,
    CASE
      WHEN catalog.category = 'CARDIO' THEN 'CARDIO'
      WHEN catalog.uses_bodyweight THEN 'BODYWEIGHT'
      WHEN lower(catalog.name) LIKE '%barbell%' THEN 'BARBELL'
      WHEN lower(catalog.name) LIKE '%machine%' OR lower(catalog.name) LIKE '%leg press%' THEN 'MACHINE'
      WHEN lower(catalog.name) LIKE '%cable%'
        OR lower(catalog.name) LIKE '%pulldown%'
        OR lower(catalog.name) LIKE '%pushdown%' THEN 'CABLE'
      WHEN lower(catalog.name) LIKE '%dumbbell%' THEN 'DUMBBELL'
      ELSE 'OTHER'
    END
  );

-- Only rows carrying proven server-owned catalog origin receive reviewed
-- profiles. Entries without richer mappings below keep their catalog primary
-- muscle while every other dimension remains explicitly unknown.
UPDATE "Exercise"
SET "loadProfile" = "loadProfile" || jsonb_build_object(
  'classification', 'REVIEWED',
  'provenance', 'SYSTEM_CATALOG_REVIEW',
  'confidence', CASE WHEN "muscleGroup" = 'OTHER' THEN 'LOW' ELSE 'MEDIUM' END,
  'primaryMuscles', CASE
    WHEN "muscleGroup" = 'OTHER' THEN jsonb_build_object('state', 'UNKNOWN', 'entries', '[]'::jsonb)
    ELSE jsonb_build_object(
      'state', 'KNOWN',
      'entries', jsonb_build_array(jsonb_build_object(
        'muscleGroup', "muscleGroup"::text,
        'provenance', 'SYSTEM_CATALOG_REVIEW',
        'confidence', 'MEDIUM'
      ))
    )
  END
)
WHERE "catalogOrigin" = 'SYSTEM_DEFAULT_V1';

UPDATE "Exercise"
SET "loadProfile" = "loadProfile" || '{
  "secondaryMuscles":{"state":"KNOWN","entries":[
    {"muscleGroup":"TRICEPS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"SHOULDERS_FRONT","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "movementPatterns":{"state":"KNOWN","entries":[{"value":"HORIZONTAL_PUSH","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}]},
  "fatigueTags":{"state":"KNOWN","entries":[{"value":"SYSTEMIC_COMPOUND","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}]},
  "jointStress":{"state":"KNOWN","entries":[
    {"value":"SHOULDER","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"ELBOW","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"WRIST","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]}
}'::jsonb
WHERE "catalogOrigin" = 'SYSTEM_DEFAULT_V1'
  AND "name" IN ('Barbell bench press', 'Incline dumbbell press (30 deg)', 'Flat dumbbell bench press');

UPDATE "Exercise"
SET "loadProfile" = "loadProfile" || '{
  "secondaryMuscles":{"state":"KNOWN","entries":[
    {"muscleGroup":"BICEPS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"FOREARMS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "movementPatterns":{"state":"KNOWN","entries":[
    {"value":"VERTICAL_PULL","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"ELBOW_FLEXION","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "fatigueTags":{"state":"KNOWN","entries":[
    {"value":"SYSTEMIC_COMPOUND","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"GRIP","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "jointStress":{"state":"KNOWN","entries":[
    {"value":"SHOULDER","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"ELBOW","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"WRIST","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]}
}'::jsonb
WHERE "catalogOrigin" = 'SYSTEM_DEFAULT_V1'
  AND "name" IN ('Pronated pull-ups (weighted if possible)', 'Lat pulldown (wide grip)', 'Neutral-grip lat pulldown');

UPDATE "Exercise"
SET "loadProfile" = "loadProfile" || '{
  "secondaryMuscles":{"state":"KNOWN","entries":[
    {"muscleGroup":"TRICEPS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"SHOULDERS_LATERAL","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "movementPatterns":{"state":"KNOWN","entries":[{"value":"VERTICAL_PUSH","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}]},
  "fatigueTags":{"state":"KNOWN","entries":[{"value":"SYSTEMIC_COMPOUND","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}]},
  "jointStress":{"state":"KNOWN","entries":[
    {"value":"SHOULDER","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"ELBOW","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"WRIST","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]}
}'::jsonb
WHERE "catalogOrigin" = 'SYSTEM_DEFAULT_V1'
  AND "name" = 'Seated dumbbell overhead press';

UPDATE "Exercise"
SET "loadProfile" = "loadProfile" || '{
  "secondaryMuscles":{"state":"KNOWN","entries":[
    {"muscleGroup":"TRICEPS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"SHOULDERS_LATERAL","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"LOWER_BACK","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "movementPatterns":{"state":"KNOWN","entries":[
    {"value":"VERTICAL_PUSH","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"TRUNK_STABILIZATION","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "fatigueTags":{"state":"KNOWN","entries":[
    {"value":"SYSTEMIC_COMPOUND","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"AXIAL_LOAD","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"LUMBAR_ISOMETRIC","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "jointStress":{"state":"KNOWN","entries":[
    {"value":"SHOULDER","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"ELBOW","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"WRIST","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"LUMBAR_SPINE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]}
}'::jsonb
WHERE "catalogOrigin" = 'SYSTEM_DEFAULT_V1'
  AND "name" = 'Standing barbell overhead press';

UPDATE "Exercise"
SET "loadProfile" = "loadProfile" || '{
  "secondaryMuscles":{"state":"KNOWN","entries":[
    {"muscleGroup":"BACK_WIDTH","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"BICEPS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"SHOULDERS_REAR","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"FOREARMS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "movementPatterns":{"state":"KNOWN","entries":[
    {"value":"HORIZONTAL_PULL","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"ROW","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"ELBOW_FLEXION","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "fatigueTags":{"state":"KNOWN","entries":[
    {"value":"SYSTEMIC_COMPOUND","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"GRIP","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "jointStress":{"state":"KNOWN","entries":[
    {"value":"SHOULDER","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"ELBOW","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"WRIST","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]}
}'::jsonb
WHERE "catalogOrigin" = 'SYSTEM_DEFAULT_V1'
  AND "name" IN ('Seated cable row (close handles)', 'Single-arm dumbbell row');

UPDATE "Exercise"
SET "loadProfile" = "loadProfile" || '{
  "secondaryMuscles":{"state":"KNOWN","entries":[
    {"muscleGroup":"BACK_WIDTH","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"BICEPS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"SHOULDERS_REAR","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"FOREARMS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"LOWER_BACK","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "movementPatterns":{"state":"KNOWN","entries":[
    {"value":"HORIZONTAL_PULL","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"ROW","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"HIP_HINGE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"TRUNK_STABILIZATION","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "fatigueTags":{"state":"KNOWN","entries":[
    {"value":"SYSTEMIC_COMPOUND","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"AXIAL_LOAD","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"LUMBAR_ISOMETRIC","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"GRIP","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "jointStress":{"state":"KNOWN","entries":[
    {"value":"SHOULDER","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"ELBOW","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"WRIST","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"LUMBAR_SPINE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"HIP","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]}
}'::jsonb
WHERE "catalogOrigin" = 'SYSTEM_DEFAULT_V1'
  AND "name" = 'Bent-over barbell row';

UPDATE "Exercise"
SET "loadProfile" = "loadProfile" || '{
  "secondaryMuscles":{"state":"KNOWN","entries":[
    {"muscleGroup":"GLUTES","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"HAMSTRINGS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "movementPatterns":{"state":"KNOWN","entries":[{"value":"SQUAT_KNEE_DOMINANT","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}]},
  "fatigueTags":{"state":"KNOWN","entries":[
    {"value":"SYSTEMIC_COMPOUND","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"AXIAL_LOAD","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "jointStress":{"state":"KNOWN","entries":[
    {"value":"HIP","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"KNEE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"LUMBAR_SPINE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]}
}'::jsonb
WHERE "catalogOrigin" = 'SYSTEM_DEFAULT_V1'
  AND "name" = 'Machine squat (or Hack squat)';

UPDATE "Exercise"
SET "loadProfile" = "loadProfile" || '{
  "secondaryMuscles":{"state":"KNOWN","entries":[
    {"muscleGroup":"GLUTES","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"LOWER_BACK","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"FOREARMS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "movementPatterns":{"state":"KNOWN","entries":[
    {"value":"HIP_HINGE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"TRUNK_STABILIZATION","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "fatigueTags":{"state":"KNOWN","entries":[
    {"value":"SYSTEMIC_COMPOUND","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"AXIAL_LOAD","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"LUMBAR_ISOMETRIC","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"GRIP","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "jointStress":{"state":"KNOWN","entries":[
    {"value":"HIP","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"KNEE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"LUMBAR_SPINE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"WRIST","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]}
}'::jsonb
WHERE "catalogOrigin" = 'SYSTEM_DEFAULT_V1'
  AND "name" IN ('Dumbbell Romanian Deadlift', 'Romanian Deadlift');

UPDATE "Exercise"
SET "loadProfile" = "loadProfile" || '{
  "secondaryMuscles":{"state":"KNOWN","entries":[
    {"muscleGroup":"GLUTES","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"HAMSTRINGS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"QUADS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"LOWER_BACK","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"muscleGroup":"FOREARMS","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "movementPatterns":{"state":"KNOWN","entries":[
    {"value":"HIP_HINGE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"TRUNK_STABILIZATION","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "fatigueTags":{"state":"KNOWN","entries":[
    {"value":"SYSTEMIC_COMPOUND","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"AXIAL_LOAD","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"LUMBAR_ISOMETRIC","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"GRIP","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]},
  "jointStress":{"state":"KNOWN","entries":[
    {"value":"HIP","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"KNEE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"LUMBAR_SPINE","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"},
    {"value":"WRIST","provenance":"SYSTEM_CATALOG_REVIEW","confidence":"MEDIUM"}
  ]}
}'::jsonb
WHERE "catalogOrigin" = 'SYSTEM_DEFAULT_V1'
  AND "name" = 'Deadlift';

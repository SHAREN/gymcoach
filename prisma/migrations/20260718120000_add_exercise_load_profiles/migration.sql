ALTER TABLE "Exercise"
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

-- Exact catalog names are an auditable reviewed list. Entries not given a
-- richer mapping below keep their catalog primary muscle while every other
-- dimension remains explicitly unknown.
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
WHERE "name" IN (
  'Barbell bench press', 'Incline dumbbell press (30 deg)', 'Pec deck (or cable fly)',
  'Pronated pull-ups (weighted if possible)', 'Lat pulldown (wide grip)',
  'Bent-over barbell row', 'Seated cable row (close handles)',
  'Seated dumbbell overhead press', 'Cable lateral raises', 'Machine rear delt fly',
  'EZ-bar curl', 'Incline dumbbell curl (bench 60 deg)', 'Machine dips or parallel bars',
  'Triceps pushdown (rope)', 'Machine squat (or Hack squat)', 'Leg extension',
  'Walking lunges with dumbbells', 'Dumbbell Romanian Deadlift', 'Seated leg curl',
  'Barbell hip thrust (or machine)', 'Hip adduction machine',
  'Standing calf raise (or machine)', 'Seated calf raise machine',
  'Cable crunch (kneeling)', 'Hanging leg raises', 'Plank + side plank',
  'Flat dumbbell bench press', 'Machine chest press', 'Neutral-grip lat pulldown',
  'Straight-arm cable pulldown', 'Chest-supported machine row',
  'Single-arm dumbbell row', 'Standing barbell overhead press',
  'Dumbbell lateral raise', 'Face pull (rope)', 'Standing cable curl (straight bar)',
  'Concentration curl', 'Barbell wrist curl', 'Reverse EZ-bar curl',
  'Hammer curl (dumbbell)', 'Close-grip bench press',
  'Overhead cable triceps extension', 'EZ-bar skull crusher', 'Leg press (45 deg)',
  'Goblet squat', 'Bulgarian split squat', 'Lying leg curl',
  'Cable glute kickback', 'Back extension (hyperextension)', 'Barbell good morning',
  'Machine crunch', 'Running', 'Rowing machine', 'Cycling', 'Jump rope',
  'Deadlift', 'Romanian Deadlift'
);

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
WHERE "name" IN ('Barbell bench press', 'Incline dumbbell press (30 deg)', 'Flat dumbbell bench press');

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
WHERE "name" IN ('Pronated pull-ups (weighted if possible)', 'Lat pulldown (wide grip)', 'Neutral-grip lat pulldown');

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
WHERE "name" = 'Seated dumbbell overhead press';

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
WHERE "name" = 'Standing barbell overhead press';

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
WHERE "name" IN ('Seated cable row (close handles)', 'Single-arm dumbbell row');

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
WHERE "name" = 'Bent-over barbell row';

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
WHERE "name" = 'Machine squat (or Hack squat)';

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
WHERE "name" IN ('Dumbbell Romanian Deadlift', 'Romanian Deadlift');

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
WHERE "name" = 'Deadlift';

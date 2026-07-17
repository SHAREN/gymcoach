import type {
  BarbellDiameterFamily,
  EquipmentLoadType,
  EquipmentType,
  GymInventoryMode,
} from '@/lib/prisma-client';
import type { ResolvedEquipmentLoadProfile } from '@/lib/gym-loads';

export interface GymInventoryExercise {
  id: string;
  name: string;
  muscleGroup: string;
  category: string;
  equipmentType: EquipmentType;
  notes: string | null;
}

export interface GymPlateInventoryItemView {
  id: string;
  weightKg: number;
  quantity: number | null;
}

export interface GymPlatePoolView {
  id: string;
  name: string;
  compatibilityKey: string;
  systemBarbellFamily: BarbellDiameterFamily | null;
  plates: GymPlateInventoryItemView[];
  equipment?: { id: string; name: string }[];
}

export interface GymEquipmentView {
  id: string;
  gymId: string;
  name: string;
  equipmentType: EquipmentType;
  description: string | null;
  manufacturer: string | null;
  modelName: string | null;
  quantity: number;
  loadType: EquipmentLoadType;
  weightOptions: number[];
  selectedLoadMultiplier: number;
  baseLoadKg: number;
  platePoolId: string | null;
  loadingSides: number;
  systemBarbellFamily: BarbellDiameterFamily | null;
  platePool: GymPlatePoolView | null;
  exerciseLinks: GymInventoryExercise[];
  preferredExerciseIds: string[];
}

export type ExerciseAvailabilitySource =
  | 'equipment'
  | 'shared-dumbbells'
  | 'legacy-config'
  | 'legacy-gym'
  | 'implicit'
  | 'none';

export interface GymExerciseCoverageView extends GymInventoryExercise {
  configured: boolean;
  isAvailable: boolean;
  availabilitySource: ExerciseAvailabilitySource;
  requiresEquipmentSelection: boolean;
  attainableLoadsKg: number[];
  equipmentOptions: ResolvedEquipmentLoadProfile[];
  equipmentIds: string[];
  preferredEquipmentId: string | null;
}

export interface GymInventoryView {
  id: string;
  name: string;
  inventoryMode: GymInventoryMode;
  sharedFreeWeights: {
    dumbbellWeightsKg: number[];
    plateWeightsKg: number[];
    barWeightsKg: number[];
  };
  platePools: GymPlatePoolView[];
  equipment: GymEquipmentView[];
  systemProfiles: {
    dumbbells: GymDumbbellsSystemProfileView;
    barbell: GymBarbellSystemProfileView;
  };
  exerciseCoverage: GymExerciseCoverageView[];
}

export interface GymDumbbellsSystemProfileView {
  id: string;
  kind: 'DUMBBELLS';
  weightsKg: number[];
  exerciseLinks: GymInventoryExercise[];
}

export interface GymBarbellFamilyView {
  family: BarbellDiameterFamily;
  pool: GymPlatePoolView;
  bars: GymEquipmentView[];
  loadingSides: number;
}

export interface GymBarbellSystemProfileView {
  id: string;
  kind: 'BARBELL';
  exerciseLinks: GymInventoryExercise[];
  families: [GymBarbellFamilyView, GymBarbellFamilyView];
}

export interface GymInventoryResponse {
  gym: GymInventoryView;
}

export interface ExerciseEquipmentChoice {
  id: string;
  name: string;
  gymId: string;
  gymName: string;
  equipmentType: EquipmentType;
  exerciseIds: string[];
  preferredExerciseIds?: string[];
  loadType?: EquipmentLoadType;
  baseLoadKg?: number;
  loadingSides?: number;
  platePoolName?: string | null;
  plates?: GymPlateInventoryItemView[];
}

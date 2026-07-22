import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { handleApiError, parseJsonBody, requireApiUserId } from '@/lib/api';
import { profileUpdateSchema } from '@/lib/schemas/profile';
import { withMobileSettingsDiagnostics } from '@/lib/mobile-settings-diagnostics';
import {
  applyCoachingProfilePatch,
  normalizeCoachingProfile,
} from '@/lib/schemas/coaching-profile';
import { Prisma } from '@/lib/prisma-client';

const MAX_PROFILE_BYTES = 128 * 1024;

const PROFILE_SELECT = {
  email: true,
  displayName: true,
  bodyweight: true,
  sex: true,
  heightCm: true,
  goal: true,
  weeklyFrequency: true,
  coachNote: true,
  coachingProfile: true,
  coachingProfileUpdatedAt: true,
  unit: true,
} as const;

function profileResponse(user: NonNullable<Awaited<ReturnType<typeof findProfile>>>) {
  const { coachingProfile, coachingProfileUpdatedAt, ...base } = user;
  return {
    ...base,
    coachingProfile: normalizeCoachingProfile(coachingProfile, coachingProfileUpdatedAt),
  };
}

function findProfile(userId: string) {
  return db.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
}

async function getProfile(req: Request) {
  try {
    const userId = await requireApiUserId(req);
    const user = await findProfile(userId);
    return NextResponse.json(user ? profileResponse(user) : null);
  } catch (err) {
    return handleApiError(err);
  }
}

async function patchProfile(req: Request) {
  try {
    const userId = await requireApiUserId(req);
    const data = await parseJsonBody(req, profileUpdateSchema, { maxBytes: MAX_PROFILE_BYTES });
    const updated = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { coachingProfile: true },
      });
      const nextCoachingProfile = data.coachingProfile
        ? applyCoachingProfilePatch(current.coachingProfile, data.coachingProfile)
        : null;
      return tx.user.update({
        where: { id: userId },
        data: {
          ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
          ...(data.bodyweight !== undefined ? { bodyweight: data.bodyweight } : {}),
          ...(data.sex !== undefined ? { sex: data.sex } : {}),
          ...(data.heightCm !== undefined ? { heightCm: data.heightCm } : {}),
          ...(data.goal !== undefined ? { goal: data.goal } : {}),
          ...(data.weeklyFrequency !== undefined ? { weeklyFrequency: data.weeklyFrequency } : {}),
          // Empty after trim -> store null (a clear), not an empty-string note.
          ...(data.coachNote !== undefined
            ? { coachNote: data.coachNote ? data.coachNote : null }
            : {}),
          ...(nextCoachingProfile
            ? {
                coachingProfile: nextCoachingProfile as Prisma.InputJsonValue,
                coachingProfileUpdatedAt: new Date(nextCoachingProfile.updatedAt!),
              }
            : {}),
          ...(data.unit !== undefined ? { unit: data.unit } : {}),
        },
        select: PROFILE_SELECT,
      });
    });
    return NextResponse.json(profileResponse(updated));
  } catch (err) {
    return handleApiError(err);
  }
}

export const GET = withMobileSettingsDiagnostics('profile', getProfile);
export const PATCH = withMobileSettingsDiagnostics('profile', patchProfile);

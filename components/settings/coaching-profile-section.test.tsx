import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCoachingProfilePatch, emptyCoachingProfile } from '@/lib/schemas/coaching-profile';
import { CoachingProfileSection } from './coaching-profile-section';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CoachingProfileSection', () => {
  it('renders every structured group and saves safety fields as a partial patch', async () => {
    const profile = emptyCoachingProfile();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          coachingProfile: { ...profile, updatedAt: '2026-07-18T10:00:00.000Z' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    render(<CoachingProfileSection initial={profile} />);

    expect(screen.getByRole('heading', { name: 'Coaching profile' })).toBeInTheDocument();
    expect(screen.getByText('Safety and feasible schedule')).toBeInTheDocument();
    expect(screen.getByText('Current limitations')).toBeInTheDocument();
    expect(screen.getByText('Priorities and preferences')).toBeInTheDocument();
    expect(screen.getByText('Baseline recovery context')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save safety and schedule' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body)) as { coachingProfile: Record<string, unknown> };
    expect(Object.keys(body.coachingProfile).sort()).toEqual([
      'availableWeekdays',
      'healthStatus',
      'maximumSessionDurationMin',
      'trainingLevel',
    ]);
    expect(body.coachingProfile.healthStatus).toEqual({ state: 'UNKNOWN', value: null });
  });

  it('shows conservative medical-clearance copy', () => {
    const profile = applyCoachingProfilePatch(
      null,
      { healthStatus: { state: 'KNOWN', value: 'MEDICAL_CLEARANCE_REQUIRED' } },
      new Date('2026-07-18T10:00:00.000Z'),
    );

    render(<CoachingProfileSection initial={profile} />);

    expect(
      screen.getByText(
        /Automatic program generation stays blocked until an appropriate qualified professional/u,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/GymCoach does not diagnose/u)).toBeInTheDocument();
  });

  it('keeps a failed section retryable', async () => {
    const profile = emptyCoachingProfile();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            coachingProfile: { ...profile, updatedAt: '2026-07-18T10:00:00.000Z' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    render(<CoachingProfileSection initial={profile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save recovery baseline' }));

    expect(await screen.findByRole('button', { name: 'Retry save' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

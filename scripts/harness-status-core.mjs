import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REQUIRED_PORTS = [3030, 3031, 5434];
const REQUIRED_DRIVES = ['C', 'D'];
const ACTIVE_THREAD_STATES = new Set([
  'active',
  'creating',
  'in-progress',
  'provisioning',
  'queued',
  'running',
  'setting-up',
  'waiting',
]);
const KNOWN_THREAD_STATES = new Set([
  ...ACTIVE_THREAD_STATES,
  'archived',
  'completed',
  'idle',
  'notloaded',
]);
const KNOWN_ROLES = new Set(['dispatcher', 'implementation', 'integration', 'verifier']);
const STAGE_PREFIX = 'stage:';
const AWAITING_INTEGRATION_STAGE = 'stage:awaiting-integration';
const THREAD_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedState(value) {
  return asString(value).toLowerCase().replaceAll('_', '-');
}

function taskStage(task) {
  return asArray(task?.labels).find((label) => asString(label).startsWith(STAGE_PREFIX)) ?? null;
}

function taskStages(task) {
  return asArray(task?.labels)
    .map(asString)
    .filter((label) => label.startsWith(STAGE_PREFIX))
    .sort(compareStrings);
}

function taskPriority(task) {
  const nativePriority = Number(task?.priority);
  if (Number.isInteger(nativePriority)) return nativePriority;
  const label = asArray(task?.labels).find((entry) => /^priority:P[0-4]$/i.test(asString(entry)));
  return label ? Number(label.slice(-1)) : 4;
}

function compareTasks(left, right) {
  return (
    taskPriority(left) - taskPriority(right) ||
    asString(left?.created_at).localeCompare(asString(right?.created_at)) ||
    asString(left?.id).localeCompare(asString(right?.id))
  );
}

function compareStrings(left, right) {
  return asString(left).localeCompare(asString(right));
}

function taskSummary(task, extra = {}) {
  return {
    id: asString(task?.id),
    title: asString(task?.title),
    priority: `P${taskPriority(task)}`,
    status: asString(task?.status),
    stage: taskStage(task),
    ...extra,
  };
}

function blockingDependencies(task, tasksById) {
  return asArray(task?.dependencies)
    .filter((dependency) => asString(dependency?.type) === 'blocks')
    .map((dependency) => {
      const id = asString(dependency?.depends_on_id ?? dependency?.dependsOnId ?? dependency?.id);
      const blocker = tasksById.get(id);
      return {
        id,
        status: asString(blocker?.status ?? dependency?.status ?? 'unknown'),
      };
    })
    .filter((dependency) => dependency.id && dependency.status !== 'closed')
    .sort((left, right) => compareStrings(left.id, right.id));
}

function classifyTasks(tasks) {
  const sortedTasks = [...tasks].sort(compareTasks);
  const tasksById = new Map(sortedTasks.map((task) => [asString(task?.id), task]));
  const activeImplementations = [];
  const reviewTasks = [];
  const verifyTasks = [];
  const awaitingIntegrationTasks = [];
  const readyTasks = [];
  const blockedTasks = [];

  for (const task of sortedTasks) {
    const status = asString(task?.status);
    const stage = taskStage(task);
    const stages = taskStages(task);
    const labels = new Set(asArray(task?.labels).map(asString));
    const blockers = blockingDependencies(task, tasksById);
    const id = asString(task?.id);
    if (!id) continue;

    if (stages.length > 1) {
      blockedTasks.push(
        taskSummary(task, {
          blockerKind: 'invalid-stage',
          blockedBy: [],
          stageLabels: stages,
        }),
      );
      continue;
    }

    if (status === 'blocked') {
      blockedTasks.push(
        taskSummary(task, {
          blockerKind: 'native',
          blockedBy: blockers.map((blocker) => blocker.id),
        }),
      );
      continue;
    }
    if (status === 'in_progress' && stage === 'stage:review') {
      reviewTasks.push(taskSummary(task));
      continue;
    }
    if (status === 'in_progress' && stage === 'stage:verify') {
      verifyTasks.push(taskSummary(task));
      continue;
    }
    if (status === 'in_progress' && stage === AWAITING_INTEGRATION_STAGE) {
      awaitingIntegrationTasks.push(taskSummary(task));
      continue;
    }
    if (status === 'open' && stage === 'stage:ready') {
      if (blockers.length > 0) {
        blockedTasks.push(
          taskSummary(task, {
            blockerKind: 'dependency',
            blockedBy: blockers.map((blocker) => blocker.id),
          }),
        );
      } else {
        readyTasks.push(taskSummary(task));
      }
      continue;
    }
    if (status === 'in_progress' && stage === null && !labels.has('role:integration-coordinator')) {
      activeImplementations.push(taskSummary(task));
    }
  }

  return {
    activeImplementations,
    reviewTasks,
    verifyTasks,
    awaitingIntegrationTasks,
    readyTasks,
    blockedTasks,
  };
}

function parseKeyValueMarker(marker) {
  const values = {};
  for (const segment of marker.split(';')) {
    const separator = segment.indexOf('=');
    if (separator === -1) continue;
    const key = segment.slice(0, separator).trim();
    const value = segment
      .slice(separator + 1)
      .trim()
      .replace(/[.\s]+$/, '');
    if (key && value) values[key] = value;
  }
  return values;
}

function inferReservationRole(context) {
  if (/verifier|verification/i.test(context)) return 'verifier';
  if (/integration/i.test(context)) return 'integration';
  return 'implementation';
}

function parseThreadEvidence(tasks) {
  const bindings = [];
  const reservations = [];
  for (const task of tasks) {
    const taskId = asString(task?.id);
    const notes = asString(task?.notes);
    if (!taskId || !notes || asString(task?.status) === 'closed') continue;

    for (const match of notes.matchAll(/Codex worktree binding v1:\s*([^\r\n]+)/g)) {
      const values = parseKeyValueMarker(match[1]);
      const role = asString(values.role);
      const boundTaskId = asString(values.task || taskId);
      if (!KNOWN_ROLES.has(role) || !boundTaskId) continue;
      bindings.push({
        taskId: boundTaskId,
        role,
        threadId: asString(values.thread) || null,
        clientThreadId: asString(values['client-thread']) || null,
        hostId: asString(values.host) || null,
        pathSha256: asString(values['path-sha256']) || null,
        worktree: asString(values.worktree) || null,
      });
    }

    for (const match of notes.matchAll(/client-new-thread:[0-9a-f-]{16,}/gi)) {
      const identity = match[0].toLowerCase();
      const context = notes.slice(
        Math.max(0, match.index - 180),
        match.index + match[0].length + 80,
      );
      reservations.push({
        taskId,
        role: inferReservationRole(context),
        clientThreadId: identity,
      });
    }
  }

  const bindingKeys = new Set();
  const uniqueBindings = bindings
    .filter((binding) => {
      const key = `${binding.taskId}\0${binding.role}\0${binding.threadId}\0${binding.clientThreadId}`;
      if (bindingKeys.has(key)) return false;
      bindingKeys.add(key);
      return true;
    })
    .sort((left, right) =>
      compareStrings(
        `${left.taskId}:${left.role}:${left.threadId ?? left.clientThreadId ?? ''}`,
        `${right.taskId}:${right.role}:${right.threadId ?? right.clientThreadId ?? ''}`,
      ),
    );

  const reservationKeys = new Set();
  const uniqueReservations = reservations
    .map((reservation) => {
      const binding = uniqueBindings.find(
        (candidate) => candidate.clientThreadId === reservation.clientThreadId,
      );
      return binding ? { ...reservation, taskId: binding.taskId, role: binding.role } : reservation;
    })
    .filter((reservation) => {
      if (
        uniqueBindings.some(
          (binding) =>
            binding.taskId === reservation.taskId &&
            binding.role === reservation.role &&
            binding.threadId,
        )
      ) {
        return false;
      }
      const key = `${reservation.taskId}\0${reservation.role}\0${reservation.clientThreadId}`;
      if (reservationKeys.has(key)) return false;
      reservationKeys.add(key);
      return true;
    })
    .sort((left, right) =>
      compareStrings(
        `${left.taskId}:${left.role}:${left.clientThreadId}`,
        `${right.taskId}:${right.role}:${right.clientThreadId}`,
      ),
    );

  return { bindings: uniqueBindings, reservations: uniqueReservations };
}

function snapshotAgeIsValid(capturedAt, observedAt) {
  const captured = Date.parse(asString(capturedAt));
  const observed = Date.parse(asString(observedAt));
  if (!Number.isFinite(captured) || !Number.isFinite(observed)) return false;
  const age = observed - captured;
  return age >= -60_000 && age <= THREAD_SNAPSHOT_MAX_AGE_MS;
}

function normalizeRawThreadSnapshot(rawSnapshot, observedAt, expectedQuery = null) {
  const structuralProblems = [];
  const request = rawSnapshot?.request;
  const response = rawSnapshot?.response;
  const scopedTaskId = expectedQuery === null ? null : asString(expectedQuery);
  const source = scopedTaskId ? 'codex_app.list_threads:task-scope' : 'codex_app.list_threads';
  if (rawSnapshot?.tool !== 'codex_app.list_threads') {
    structuralProblems.push('Codex thread snapshot is not from codex_app.list_threads.');
  }
  if (request?.limit !== 50) {
    structuralProblems.push('Codex thread snapshot must use limit 50.');
  }
  if (scopedTaskId) {
    if (asString(request?.query) !== scopedTaskId) {
      structuralProblems.push(
        `Task-scoped Codex thread snapshot query must exactly equal ${scopedTaskId}.`,
      );
    }
  } else if (request?.query !== null) {
    structuralProblems.push('Global Codex thread snapshot must be unfiltered with query null.');
  }
  if (!snapshotAgeIsValid(rawSnapshot?.capturedAt, observedAt)) {
    structuralProblems.push(
      'Codex thread snapshot is stale, future-dated, or missing a valid capture time.',
    );
  }
  if (!Array.isArray(response?.threads)) {
    structuralProblems.push('Codex thread snapshot has no thread array.');
  }
  if (
    response?.schemaVersion !== 2 ||
    (scopedTaskId ? asString(response?.query) !== scopedTaskId : response?.query !== null)
  ) {
    structuralProblems.push('Codex thread snapshot schema or query provenance is incomplete.');
  }
  if (!Array.isArray(response?.unavailableHosts) || response.unavailableHosts.length > 0) {
    structuralProblems.push('Codex thread discovery has unavailable or unreported hosts.');
  }

  const identities = new Set();
  for (const [index, thread] of asArray(response?.threads).entries()) {
    if (!thread || typeof thread !== 'object' || Array.isArray(thread)) {
      structuralProblems.push(`Codex thread ${index} is not an object.`);
      continue;
    }
    const id = asString(thread.id);
    const hostId = asString(thread.hostId);
    const status = normalizedState(thread.status);
    const cwd = asString(thread.cwd);
    if (!id) structuralProblems.push(`Codex thread ${index} has no id.`);
    if (!hostId) structuralProblems.push(`Codex thread ${index} has no hostId.`);
    if (!KNOWN_THREAD_STATES.has(status)) {
      structuralProblems.push(`Codex thread ${index} has unknown status ${status || '(missing)'}.`);
    }
    if (!cwd) structuralProblems.push(`Codex thread ${index} has no cwd.`);
    if (typeof thread.createdAt !== 'number' || !Number.isFinite(thread.createdAt)) {
      structuralProblems.push(`Codex thread ${index} has invalid createdAt.`);
    }
    if (typeof thread.updatedAt !== 'number' || !Number.isFinite(thread.updatedAt)) {
      structuralProblems.push(`Codex thread ${index} has invalid updatedAt.`);
    }
    if (typeof thread.hasUnreadTurn !== 'boolean') {
      structuralProblems.push(`Codex thread ${index} has invalid hasUnreadTurn.`);
    }
    if (id && hostId) {
      const identity = `${hostId}\0${id}`;
      if (identities.has(identity)) {
        structuralProblems.push(`Codex thread ${index} duplicates ${hostId}/${id}.`);
      }
      identities.add(identity);
    }
  }

  const items = asArray(response?.threads).map((thread) => ({
    threadId: asString(thread?.id) || null,
    clientThreadId: asString(thread?.clientThreadId) || null,
    hostId: asString(thread?.hostId) || null,
    state: normalizedState(thread?.status) || 'unknown',
    cwd: asString(thread?.cwd) || null,
    gitBranch: asString(thread?.gitBranch) || null,
    agentRole: asString(thread?.agentRole) || null,
    updatedAt: thread?.updatedAt ?? null,
    source,
  }));
  const reachedLimit = Array.isArray(response?.threads) && response.threads.length >= 50;
  const problems = [...structuralProblems];
  if (reachedLimit) {
    problems.push('Codex thread discovery reached its limit and may be truncated.');
  }
  return {
    source,
    query: scopedTaskId,
    capturedAt: asString(rawSnapshot?.capturedAt) || null,
    complete: structuralProblems.length === 0 && !reachedLimit,
    structurallyValid: structuralProblems.length === 0,
    reachedLimit,
    problems,
    items,
  };
}

function normalizeThreadInput(threadInput, observedAt) {
  if (threadInput?.snapshot) {
    return normalizeRawThreadSnapshot(threadInput.snapshot, observedAt);
  }
  const problems = asArray(threadInput?.problems).map(asString).filter(Boolean);
  if (threadInput?.complete !== true && problems.length === 0) {
    problems.push(
      'Desktop runtime and pending clientThreadId state are unavailable from PowerShell; creation is suppressed.',
    );
  }
  return {
    source: asString(threadInput?.source) || 'unavailable',
    complete: threadInput?.complete === true,
    structurallyValid: false,
    reachedLimit: false,
    query: null,
    capturedAt: null,
    problems,
    items: asArray(threadInput?.items).map((thread) => ({
      threadId: asString(thread?.threadId ?? thread?.id) || null,
      clientThreadId: asString(thread?.clientThreadId) || null,
      hostId: asString(thread?.hostId) || null,
      state: normalizedState(thread?.state ?? thread?.status) || 'unknown',
      cwd: asString(thread?.cwd) || null,
      gitBranch: asString(thread?.gitBranch) || null,
      agentRole: asString(thread?.agentRole) || null,
      updatedAt: thread?.updatedAt ?? thread?.updatedAtMs ?? null,
      source: asString(thread?.source) || asString(threadInput?.source) || 'local-state',
    })),
  };
}

function normalizePath(value) {
  return asString(value).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
}

function taskIdFromBranch(branch) {
  return (
    asString(branch)
      .match(/(?:^|[/-])(gymcoach-[a-z0-9.]+)(?:[-/]|$)/i)?.[1]
      ?.toLowerCase() ?? null
  );
}

function classifyThreads(threadInput, threadEvidence, worktrees, tasks, observedAt) {
  const normalized = normalizeThreadInput(threadInput, observedAt);
  const knownTaskIds = new Set(tasks.map((task) => asString(task?.id)).filter(Boolean));
  const evidenceProblems = [];
  const bindingsByThread = new Map();
  const bindingsByClientThread = new Map();
  const addBinding = (map, key, binding) => {
    const group = map.get(key) ?? [];
    group.push(binding);
    map.set(key, group);
  };
  for (const binding of threadEvidence.bindings) {
    if (binding.threadId && binding.hostId) {
      addBinding(bindingsByThread, `${binding.hostId}\0${binding.threadId}`, binding);
    }
    if (binding.clientThreadId) {
      addBinding(bindingsByClientThread, binding.clientThreadId, binding);
    }
  }
  const bindingOwnerCount = (bindings) =>
    new Set(bindings.map((binding) => `${binding.taskId}\0${binding.role}`)).size;
  for (const [identity, bindings] of [...bindingsByThread, ...bindingsByClientThread]) {
    if (bindingOwnerCount(bindings) > 1) {
      evidenceProblems.push(
        `Durable thread identity ${identity.replace('\0', '/')} has conflicting task or role bindings.`,
      );
    }
  }
  const reservationsByClientThread = new Map();
  for (const reservation of threadEvidence.reservations) {
    const group = reservationsByClientThread.get(reservation.clientThreadId) ?? [];
    group.push(reservation);
    reservationsByClientThread.set(reservation.clientThreadId, group);
  }
  for (const [clientThreadId, reservations] of reservationsByClientThread) {
    if (reservations.length > 1) {
      evidenceProblems.push(
        `Durable client thread ${clientThreadId} has conflicting task or role reservations.`,
      );
    }
  }
  const worktreesByPath = new Map(
    worktrees.map((worktree) => [normalizePath(worktree.path), worktree]),
  );
  const classifyItem = (thread, scopedTaskId = null) => {
    const bindingCandidates = [
      ...(thread.threadId && thread.hostId
        ? (bindingsByThread.get(`${thread.hostId}\0${thread.threadId}`) ?? [])
        : []),
      ...(thread.clientThreadId ? (bindingsByClientThread.get(thread.clientThreadId) ?? []) : []),
    ].filter(
      (binding, index, bindings) =>
        bindings.findIndex(
          (candidate) =>
            candidate.taskId === binding.taskId &&
            candidate.role === binding.role &&
            candidate.threadId === binding.threadId &&
            candidate.clientThreadId === binding.clientThreadId &&
            candidate.hostId === binding.hostId,
        ) === index,
    );
    const bindingConflict = bindingOwnerCount(bindingCandidates) > 1;
    const binding =
      bindingCandidates.length > 0 && !bindingConflict ? bindingCandidates[0] : undefined;
    const reservationGroup = thread.clientThreadId
      ? (reservationsByClientThread.get(thread.clientThreadId) ?? [])
      : [];
    const reservation = reservationGroup.length === 1 ? reservationGroup[0] : undefined;
    const worktree = thread.cwd ? worktreesByPath.get(normalizePath(thread.cwd)) : undefined;
    const role = KNOWN_ROLES.has(asString(binding?.role))
      ? binding.role
      : KNOWN_ROLES.has(asString(reservation?.role))
        ? reservation.role
        : KNOWN_ROLES.has(asString(thread.agentRole))
          ? asString(thread.agentRole)
          : null;
    const inferredTaskId =
      asString(binding?.taskId) ||
      asString(reservation?.taskId) ||
      taskIdFromBranch(thread.gitBranch) ||
      taskIdFromBranch(worktree?.branch) ||
      null;
    return {
      taskId: inferredTaskId || scopedTaskId,
      role,
      threadId: thread.threadId,
      clientThreadId: thread.clientThreadId,
      hostId: thread.hostId,
      state: thread.state,
      cwd: thread.cwd,
      gitBranch: thread.gitBranch || asString(worktree?.branch) || null,
      source: thread.source,
      durableBinding: bindingCandidates.length > 0,
      bindingConflict,
      durableReservation: reservationGroup.length > 0,
      reservationConflict: reservationGroup.length > 1,
    };
  };
  const items = normalized.items.map((thread) => classifyItem(thread));

  const rawTaskSnapshots = asArray(threadInput?.taskSnapshots);
  const taskSnapshotCounts = new Map();
  const taskReconciliations = rawTaskSnapshots.map((entry, index) => {
    const rawSnapshot = entry?.snapshot ?? entry;
    const taskId = asString(rawSnapshot?.request?.query);
    const scoped = normalizeRawThreadSnapshot(rawSnapshot, observedAt, taskId || '(missing)');
    const scopeProblems = [...scoped.problems];
    if (!taskId) {
      scopeProblems.push(`Task-scoped Codex thread snapshot ${index} has no exact task query.`);
    } else if (!knownTaskIds.has(taskId)) {
      scopeProblems.push(
        `Task-scoped Codex thread snapshot query ${taskId} is not a current Beads task.`,
      );
    }
    const globalCapturedAt = Date.parse(normalized.capturedAt ?? '');
    const scopedCapturedAt = Date.parse(scoped.capturedAt ?? '');
    if (
      Number.isFinite(globalCapturedAt) &&
      Number.isFinite(scopedCapturedAt) &&
      scopedCapturedAt < globalCapturedAt
    ) {
      scopeProblems.push('Task-scoped Codex thread snapshot predates the global baseline.');
    }
    taskSnapshotCounts.set(taskId, (taskSnapshotCounts.get(taskId) ?? 0) + 1);

    const scopedItems = scoped.items.map((thread) => classifyItem(thread, taskId || null));
    for (const [threadIndex, item] of scopedItems.entries()) {
      if (item.taskId && item.taskId !== taskId) {
        scopeProblems.push(
          `Task-scoped Codex thread ${threadIndex} maps to ${item.taskId}, not ${taskId}.`,
        );
      }
      if (!item.role && ACTIVE_THREAD_STATES.has(item.state)) {
        scopeProblems.push(
          `Active task-scoped Codex thread ${threadIndex} has no provable implementation/verifier role.`,
        );
      }
      if (item.bindingConflict || item.reservationConflict) {
        scopeProblems.push(
          `Task-scoped Codex thread ${threadIndex} has ambiguous durable ownership.`,
        );
      }
    }
    items.push(...scopedItems);
    return {
      taskId: taskId || null,
      complete: scoped.structurallyValid && !scoped.reachedLimit && scopeProblems.length === 0,
      itemCount: scoped.items.length,
      problems: scopeProblems,
    };
  });

  for (const reconciliation of taskReconciliations) {
    if (reconciliation.taskId && taskSnapshotCounts.get(reconciliation.taskId) > 1) {
      reconciliation.complete = false;
      reconciliation.problems.push(
        `Multiple task-scoped Codex thread snapshots were supplied for ${reconciliation.taskId}.`,
      );
    }
    if (!normalized.structurallyValid || !normalized.reachedLimit) {
      reconciliation.complete = false;
      reconciliation.problems.push(
        'Task-scoped reconciliation requires a structurally valid global snapshot that reached limit 50.',
      );
    }
  }

  for (const binding of threadEvidence.bindings) {
    const represented = items.some(
      (item) =>
        item.taskId === binding.taskId &&
        item.role === binding.role &&
        item.durableBinding === true &&
        ((binding.threadId &&
          item.threadId === binding.threadId &&
          (!binding.hostId || item.hostId === binding.hostId)) ||
          (binding.clientThreadId && item.clientThreadId === binding.clientThreadId)),
    );
    if (represented) continue;
    const bindingConflict =
      (binding.threadId &&
        binding.hostId &&
        bindingOwnerCount(bindingsByThread.get(`${binding.hostId}\0${binding.threadId}`) ?? []) >
          1) ||
      (binding.clientThreadId &&
        bindingOwnerCount(bindingsByClientThread.get(binding.clientThreadId) ?? []) > 1);
    items.push({
      taskId: binding.taskId,
      role: binding.role,
      threadId: binding.threadId,
      clientThreadId: binding.clientThreadId,
      hostId: binding.hostId,
      state: bindingConflict ? 'binding-conflict' : 'bound-or-orphaned',
      cwd: binding.worktree,
      gitBranch: null,
      source: 'beads-binding',
      durableBinding: true,
      bindingConflict: Boolean(bindingConflict),
      durableReservation: false,
      reservationConflict: false,
    });
  }

  for (const reservation of threadEvidence.reservations) {
    if (
      items.some(
        (item) =>
          item.clientThreadId === reservation.clientThreadId &&
          item.taskId === reservation.taskId &&
          item.role === reservation.role &&
          item.durableReservation === true,
      )
    ) {
      continue;
    }
    const conflict = (reservationsByClientThread.get(reservation.clientThreadId) ?? []).length > 1;
    items.push({
      taskId: reservation.taskId,
      role: reservation.role,
      threadId: null,
      clientThreadId: reservation.clientThreadId,
      hostId: null,
      state: conflict ? 'reservation-conflict' : 'queued-or-orphaned',
      cwd: null,
      gitBranch: null,
      source: 'beads-reservation',
      durableBinding: false,
      bindingConflict: false,
      durableReservation: true,
      reservationConflict: conflict,
    });
  }

  const relevantItems = items.filter(
    (item) =>
      item.taskId ||
      item.role ||
      item.clientThreadId ||
      (normalized.complete && ACTIVE_THREAD_STATES.has(item.state)),
  );
  relevantItems.sort((left, right) =>
    compareStrings(
      `${left.taskId ?? '~'}:${left.role ?? '~'}:${left.threadId ?? left.clientThreadId ?? '~'}`,
      `${right.taskId ?? '~'}:${right.role ?? '~'}:${right.threadId ?? right.clientThreadId ?? '~'}`,
    ),
  );
  const reconciledTaskIds = taskReconciliations
    .filter((reconciliation) => reconciliation.complete && reconciliation.taskId)
    .map((reconciliation) => reconciliation.taskId)
    .sort(compareStrings);
  const scopedProblems = taskReconciliations.flatMap((reconciliation) =>
    reconciliation.problems.map(
      (problem) => `Task scope ${reconciliation.taskId ?? '(missing)'}: ${problem}`,
    ),
  );
  return {
    ...normalized,
    taskScopedReconciliationAvailable: normalized.structurallyValid && normalized.reachedLimit,
    reconciledTaskIds,
    taskReconciliations: taskReconciliations.sort((left, right) =>
      compareStrings(left.taskId ?? '~', right.taskId ?? '~'),
    ),
    evidenceAmbiguous: evidenceProblems.length > 0,
    problems: [...normalized.problems, ...evidenceProblems, ...scopedProblems],
    items: relevantItems,
  };
}

function classifyFullGateOwner(tasks, beadsHealthy) {
  if (!beadsHealthy) {
    return { state: 'unknown', taskId: null, candidates: [] };
  }
  const candidates = [];
  for (const task of tasks) {
    let lastEvent = null;
    for (const line of asString(task?.notes).split(/\r?\n/)) {
      const grant =
        /\bGRANTED\b.*\bfull-gate ownership\b/i.test(line) ||
        /\bfull-gate ownership\b.*\bGRANTED\b/i.test(line);
      const release =
        /\b(?:FINAL\s+)?RELEASE(?:D)?\b.*\bfull-gate ownership\b/i.test(line) ||
        /\bfull-gate ownership\b.*\bRELEASE(?:D)?\b/i.test(line);
      if (grant) lastEvent = 'grant';
      if (release) lastEvent = 'release';
    }
    if (lastEvent === 'grant') candidates.push(asString(task?.id));
  }
  candidates.sort(compareStrings);
  if (candidates.length === 0) return { state: 'none', taskId: null, candidates: [] };
  if (candidates.length === 1) {
    return { state: 'owned', taskId: candidates[0], candidates };
  }
  return { state: 'ambiguous', taskId: null, candidates };
}

function normalizeWorktrees(worktrees) {
  return asArray(worktrees)
    .map((worktree) => ({
      path: asString(worktree?.path),
      head: asString(worktree?.head) || null,
      branch: asString(worktree?.branch) || null,
      detached: worktree?.detached === true,
      locked: worktree?.locked === true,
      prunable: worktree?.prunable === true,
    }))
    .filter((worktree) => worktree.path)
    .sort((left, right) => compareStrings(normalizePath(left.path), normalizePath(right.path)));
}

function normalizeDisks(disks) {
  const byName = new Map(
    asArray(disks).map((disk) => [asString(disk?.name).replace(/:$/, '').toUpperCase(), disk]),
  );
  return REQUIRED_DRIVES.map((name) => {
    const disk = byName.get(name);
    return {
      name,
      exists: Boolean(disk),
      freeBytes: disk && Number.isFinite(Number(disk.freeBytes)) ? Number(disk.freeBytes) : null,
    };
  });
}

function normalizePorts(ports) {
  const byPort = new Map(asArray(ports).map((port) => [Number(port?.port), port]));
  return REQUIRED_PORTS.map((portNumber) => {
    const port = byPort.get(portNumber);
    return {
      port: portNumber,
      observed: Boolean(port),
      listening: port?.listening === true,
      ownerPid:
        port?.ownerPid !== null &&
        port?.ownerPid !== undefined &&
        Number.isInteger(Number(port.ownerPid))
          ? Number(port.ownerPid)
          : null,
      processName: asString(port?.processName) || null,
    };
  });
}

function threadRepresentsRole(codexThreads, taskId, role) {
  return codexThreads.items.some(
    (thread) =>
      thread.taskId === taskId &&
      thread.role === role &&
      (thread.source === 'beads-reservation' ||
        thread.durableBinding === true ||
        thread.durableReservation === true ||
        ACTIVE_THREAD_STATES.has(thread.state)),
  );
}

function threadDiscoveryCompleteForTask(codexThreads, taskId) {
  return codexThreads.complete || codexThreads.reconciledTaskIds.includes(taskId);
}

function action(key, type, taskId, transition, reason) {
  return { key, type, taskId, transition, reason };
}

function proposedActions(taskGroups, codexThreads, fullGateOwner, sourceHealth) {
  const actions = [];

  if (!codexThreads.complete) {
    actions.push(
      action(
        'inspect-thread-source',
        'inspect-thread-source',
        null,
        false,
        codexThreads.taskScopedReconciliationAvailable
          ? 'Global thread discovery reached limit 50. Use exact task-scoped reconciliation for each writer/verifier candidate before creation.'
          : 'Thread discovery is incomplete. Do not retry create_thread; inspect durable reservations and obtain a fresh complete snapshot.',
      ),
    );
  }

  for (const task of taskGroups.reviewTasks) {
    if (threadRepresentsRole(codexThreads, task.id, 'verifier')) {
      actions.push(
        action(
          `wait-verifier:${task.id}`,
          'wait-verifier',
          task.id,
          false,
          'An active, queued, or unresolved verifier identity already represents this task.',
        ),
      );
    } else if (
      sourceHealth.sources.beads.ok === true &&
      threadDiscoveryCompleteForTask(codexThreads, task.id)
    ) {
      actions.push(
        action(
          `start-verifier:${task.id}`,
          'start-verifier',
          task.id,
          true,
          codexThreads.complete
            ? 'REVIEW is ready and complete global thread discovery shows no verifier identity.'
            : 'REVIEW is ready and exact task-scoped reconciliation shows no verifier identity.',
        ),
      );
    }
  }

  for (const task of taskGroups.readyTasks) {
    if (threadRepresentsRole(codexThreads, task.id, 'implementation')) {
      actions.push(
        action(
          `wait-writer:${task.id}`,
          'wait-writer',
          task.id,
          false,
          'An active, queued, or unresolved writer identity already represents this task.',
        ),
      );
    } else if (
      sourceHealth.sources.beads.ok === true &&
      threadDiscoveryCompleteForTask(codexThreads, task.id)
    ) {
      actions.push(
        action(
          `start-writer:${task.id}`,
          'start-writer',
          task.id,
          true,
          codexThreads.complete
            ? 'READY is blocker-free and complete global thread discovery shows no writer identity.'
            : 'READY is blocker-free and exact task-scoped reconciliation shows no writer identity.',
        ),
      );
    }
  }

  for (const task of taskGroups.verifyTasks) {
    actions.push(
      action(
        `${threadRepresentsRole(codexThreads, task.id, 'verifier') ? 'wait' : 'inspect'}-verify:${task.id}`,
        threadRepresentsRole(codexThreads, task.id, 'verifier')
          ? 'wait-verifier'
          : 'inspect-verify-ownership',
        task.id,
        false,
        threadRepresentsRole(codexThreads, task.id, 'verifier')
          ? 'VERIFY already has a verifier identity.'
          : 'VERIFY has no proven verifier identity. Inspect manually; never create a duplicate automatically.',
      ),
    );
  }

  for (const task of taskGroups.awaitingIntegrationTasks) {
    actions.push(
      action(
        `inspect-integration:${task.id}`,
        'inspect-integration',
        task.id,
        false,
        'Select the authoritative root and verified dependency set before dispatching integration.',
      ),
    );
  }

  for (const task of taskGroups.blockedTasks) {
    actions.push(
      action(
        `wait-blocker:${task.id}`,
        'wait-blocker',
        task.id,
        false,
        task.blockerKind === 'dependency'
          ? `READY remains blocked by: ${task.blockedBy.join(', ')}.`
          : task.blockerKind === 'invalid-stage'
            ? `Task has multiple stage labels: ${task.stageLabels.join(', ')}.`
            : 'The task is natively blocked and requires its recorded unblock condition.',
      ),
    );
  }

  if (fullGateOwner.state === 'owned') {
    actions.push(
      action(
        `wait-full-gate:${fullGateOwner.taskId}`,
        'wait-full-gate',
        fullGateOwner.taskId,
        false,
        'The shared full-gate slot has an unreleased owner.',
      ),
    );
  } else if (fullGateOwner.state === 'ambiguous') {
    actions.push(
      action(
        'inspect-full-gate-owner',
        'inspect-full-gate-owner',
        null,
        false,
        `Multiple tasks have unreleased grant histories: ${fullGateOwner.candidates.join(', ')}.`,
      ),
    );
  }

  const order = new Map([
    ['inspect-thread-source', 0],
    ['start-verifier', 1],
    ['start-writer', 2],
    ['wait-verifier', 3],
    ['wait-writer', 4],
    ['inspect-verify-ownership', 5],
    ['inspect-integration', 6],
    ['wait-full-gate', 7],
    ['inspect-full-gate-owner', 8],
    ['wait-blocker', 9],
  ]);
  return actions.sort(
    (left, right) =>
      (order.get(left.type) ?? 99) - (order.get(right.type) ?? 99) ||
      compareStrings(left.key, right.key),
  );
}

function normalizeSourceHealth(input, codexThreads, taskGroups) {
  const sourceNames = ['beads', 'git', 'disks', 'ports'];
  const sources = {};
  const problems = [];
  for (const name of sourceNames) {
    const source = input?.[name] ?? {};
    sources[name] = {
      ok: source.ok === true,
      detail: asString(source.detail) || null,
    };
    if (!sources[name].ok) problems.push(sources[name].detail ?? `${name} source failed.`);
  }
  sources.codexThreads = {
    ok:
      (codexThreads.structurallyValid || codexThreads.complete) && !codexThreads.evidenceAmbiguous,
    complete: codexThreads.complete,
    source: codexThreads.source,
    taskScopedReconciliationAvailable: codexThreads.taskScopedReconciliationAvailable,
    reconciledTaskIds: codexThreads.reconciledTaskIds,
    detail: codexThreads.problems[0] ?? null,
  };
  problems.push(...codexThreads.problems);
  const creationCandidates = [
    ...taskGroups.reviewTasks.map((task) => ({ task, role: 'verifier' })),
    ...taskGroups.readyTasks.map((task) => ({ task, role: 'implementation' })),
  ];
  const unresolvedCreationTaskIds = creationCandidates
    .filter(
      ({ task, role }) =>
        !threadRepresentsRole(codexThreads, task.id, role) &&
        !threadDiscoveryCompleteForTask(codexThreads, task.id),
    )
    .map(({ task }) => task.id)
    .sort(compareStrings);
  const startableCreationTaskIds = creationCandidates
    .filter(
      ({ task, role }) =>
        !threadRepresentsRole(codexThreads, task.id, role) &&
        threadDiscoveryCompleteForTask(codexThreads, task.id),
    )
    .map(({ task }) => task.id)
    .sort(compareStrings);
  const threadCoverageHealthy = codexThreads.complete || unresolvedCreationTaskIds.length === 0;
  return {
    ok:
      sourceNames.every((name) => sources[name].ok) &&
      sources.codexThreads.ok &&
      threadCoverageHealthy,
    creationRecommendationsSuppressed:
      sources.beads.ok !== true ||
      (unresolvedCreationTaskIds.length > 0 && startableCreationTaskIds.length === 0),
    suppressedCreationTaskIds: unresolvedCreationTaskIds,
    sources,
    problems: [...new Set(problems.filter(Boolean))],
  };
}

export function classifyHarnessSnapshot(snapshot) {
  const observedAt = asString(snapshot?.observedAt) || new Date(0).toISOString();
  const tasks = asArray(snapshot?.tasks);
  const taskGroups = classifyTasks(tasks);
  const worktrees = normalizeWorktrees(snapshot?.worktrees);
  const threadEvidence = parseThreadEvidence(tasks);
  const codexThreads = classifyThreads(
    snapshot?.threads ?? {},
    threadEvidence,
    worktrees,
    tasks,
    observedAt,
  );
  const sourceHealth = normalizeSourceHealth(
    snapshot?.sourceHealth ?? {},
    codexThreads,
    taskGroups,
  );
  const fullGateOwner = classifyFullGateOwner(tasks, sourceHealth.sources.beads.ok);
  const disks = normalizeDisks(snapshot?.disks);
  const ports = normalizePorts(snapshot?.ports);
  return {
    schemaVersion: 2,
    observedAt,
    activeImplementations: taskGroups.activeImplementations,
    reviewTasks: taskGroups.reviewTasks,
    verifyTasks: taskGroups.verifyTasks,
    awaitingIntegrationTasks: taskGroups.awaitingIntegrationTasks,
    readyTasks: taskGroups.readyTasks,
    blockedTasks: taskGroups.blockedTasks,
    codexThreads,
    worktrees,
    disks,
    ports,
    fullGateOwner,
    sourceHealth,
    proposedActions: proposedActions(taskGroups, codexThreads, fullGateOwner, sourceHealth),
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const fixtureIndex = process.argv.indexOf('--fixture');
  let input;
  if (fixtureIndex !== -1) {
    const fixturePath = process.argv[fixtureIndex + 1];
    if (!fixturePath) throw new Error('--fixture requires a path');
    input = await readFile(fixturePath, 'utf8');
  } else if (process.argv.includes('--stdin')) {
    input = await readStdin();
  } else {
    throw new Error('Use --fixture PATH or --stdin');
  }
  const snapshot = JSON.parse(input);
  process.stdout.write(`${JSON.stringify(classifyHarnessSnapshot(snapshot))}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

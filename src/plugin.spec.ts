import { beforeAll, beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import type { IssueProviderPluginDefinition, Task } from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;
let getOAuthTokenMock: ReturnType<typeof vi.fn>;
let requestMock: ReturnType<typeof vi.fn>;
let registerHookMock: ReturnType<typeof vi.fn>;
let logDebugMock: ReturnType<typeof vi.fn>;
let loadSyncedDataMock: ReturnType<typeof vi.fn>;
let persistDataSyncedMock: ReturnType<typeof vi.fn>;
let showSnackMock: ReturnType<typeof vi.fn>;
let clearTodolistCacheForTests: () => void;
let postAuthenticatedJsonForTests: <TResponse = unknown>(
  url: string,
  body: unknown,
) => Promise<TResponse | undefined>;
let watermarkStoreForTests: typeof import('./plugin').__watermarkStoreForTests;
let providerConfigStoreForTests: typeof import('./plugin').__providerConfigStoreForTests;
const registeredHooks: Record<string, (payload: unknown) => void | Promise<void>> = {};

const makeHttp = () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  request: vi.fn(),
});

beforeAll(async () => {
  getOAuthTokenMock = vi.fn().mockResolvedValue('mock-token');
  requestMock = vi.fn();
  registerHookMock = vi.fn((hook: string, handler: (payload: unknown) => void) => {
    registeredHooks[hook] = handler;
  });
  logDebugMock = vi.fn();
  loadSyncedDataMock = vi.fn().mockResolvedValue(null);
  persistDataSyncedMock = vi.fn().mockResolvedValue(undefined);
  showSnackMock = vi.fn();
  (globalThis as any).PluginAPI = {
    registerIssueProvider: vi.fn((def: IssueProviderPluginDefinition) => {
      definition = def;
    }),
    registerHook: registerHookMock,
    translate: vi.fn((key: string) => key),
    startOAuthFlow: vi.fn(),
    getOAuthToken: getOAuthTokenMock,
    request: requestMock,
    loadSyncedData: loadSyncedDataMock,
    persistDataSynced: persistDataSyncedMock,
    showSnack: showSnackMock,
    onReady: vi.fn(),
    log: {
      debug: logDebugMock,
    },
  };
  (globalThis as any).__TEST__ = true;
  const pluginModule = await import('./plugin');
  clearTodolistCacheForTests = pluginModule.__clearTodolistCacheForTests;
  postAuthenticatedJsonForTests = pluginModule.__postAuthenticatedJsonForTests;
  watermarkStoreForTests = pluginModule.__watermarkStoreForTests;
  providerConfigStoreForTests = pluginModule.__providerConfigStoreForTests;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Basecamp Issue Provider Plugin', () => {
  beforeEach(() => {
    getOAuthTokenMock.mockReset();
    getOAuthTokenMock.mockResolvedValue('mock-token');
    requestMock.mockReset();
    logDebugMock.mockReset();
    loadSyncedDataMock.mockReset();
    loadSyncedDataMock.mockResolvedValue(null);
    persistDataSyncedMock.mockReset();
    persistDataSyncedMock.mockResolvedValue(undefined);
    showSnackMock.mockReset();
    clearTodolistCacheForTests();
    watermarkStoreForTests.clear();
    providerConfigStoreForTests.clear();
  });

  describe('time tracking hook registration', () => {
    const makeTask = (overrides: Partial<Task> = {}): Task =>
      ({
        id: 'task-1',
        title: 'Tracked todo',
        timeEstimate: 0,
        timeSpent: 3600000,
        isDone: false,
        projectId: 'project-1',
        tagIds: [],
        created: 1,
        subTaskIds: [],
        issueId: '101',
        issueType: 'plugin:basecamp-issue-provider',
        issueProviderId: 'provider-1',
        timeSpentOnDay: { '2026-07-01': 3600000 },
        ...overrides,
      }) as Task;

    it('registers task stop and completion hooks', () => {
      expect(registerHookMock).toHaveBeenCalledWith(
        'currentTaskChange',
        expect.any(Function),
      );
      expect(registerHookMock).toHaveBeenCalledWith('taskComplete', expect.any(Function));
      expect(registeredHooks.currentTaskChange).toEqual(expect.any(Function));
      expect(registeredHooks.taskComplete).toEqual(expect.any(Function));
    });

    it('triggers time push for stop events when timeTracking is onStop', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'onStop' });
      requestMock.mockResolvedValue({ ok: true });

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });

      expect(requestMock).toHaveBeenCalledWith(
        'https://3.basecampapi.com/acc-123/recordings/101/timesheet/entries.json',
        expect.objectContaining({
          method: 'POST',
          body: { date: '2026-07-01', hours: '1.00' },
        }),
      );
      expect(logDebugMock).toHaveBeenCalledWith(
        '[basecamp-issue-provider] Time pushed successfully',
        expect.objectContaining({
          taskId: 'task-1',
          issueId: '101',
          date: '2026-07-01',
          deltaMs: 3600000,
          hours: '1.00',
        }),
      );
    });

    it('triggers time push for done events when timeTracking is onDone', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'onDone' });
      requestMock.mockResolvedValue({ ok: true });

      await registeredHooks.taskComplete({
        taskId: 'task-1',
        task: makeTask({ isDone: true }),
      });

      expect(requestMock).toHaveBeenCalledWith(
        'https://3.basecampapi.com/acc-123/recordings/101/timesheet/entries.json',
        expect.objectContaining({
          method: 'POST',
          body: { date: '2026-07-01', hours: '1.00' },
        }),
      );
      expect(logDebugMock).toHaveBeenCalledWith(
        '[basecamp-issue-provider] Time pushed successfully',
        expect.objectContaining({
          taskId: 'task-1',
          issueId: '101',
          date: '2026-07-01',
          deltaMs: 3600000,
          hours: '1.00',
        }),
      );
    });

    it('triggers time push for both stop and done events when timeTracking is both', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockResolvedValue({ ok: true });

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });
      await registeredHooks.taskComplete({
        taskId: 'task-1',
        task: makeTask({
          isDone: true,
          timeSpentOnDay: { '2026-07-01': 7200000 }, // +1 hour for second event
        }),
      });

      expect(logDebugMock).toHaveBeenCalledTimes(2);
      expect(logDebugMock).toHaveBeenCalledWith(
        '[basecamp-issue-provider] Time pushed successfully',
        expect.objectContaining({ taskId: 'task-1', issueId: '101' }),
      );
    });

    it('skips time push when timeTracking is off', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'off' });
      requestMock.mockResolvedValue({ ok: true });

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });
      await registeredHooks.taskComplete({
        taskId: 'task-1',
        task: makeTask({ isDone: true }),
      });

      expect(logDebugMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('pushes time on both stop and done when timeTracking is undefined in cached config (defaults to both)', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123' }); // no timeTracking, defaults to both
      requestMock.mockResolvedValue({ ok: true });

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });
      await registeredHooks.taskComplete({
        taskId: 'task-1',
        task: makeTask({
          isDone: true,
          timeSpentOnDay: { '2026-07-01': 7200000 }, // +1 hour for second event
        }),
      });

      expect(logDebugMock).toHaveBeenCalledTimes(2);
      expect(logDebugMock).toHaveBeenCalledWith(
        '[basecamp-issue-provider] Time pushed successfully',
        expect.anything(),
      );
      expect(requestMock).toHaveBeenCalledTimes(2);
    });

    it('skips time push when no cached provider config for the todo', async () => {
      // Do NOT set provider config for this todo
      requestMock.mockResolvedValue({ ok: true });

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });
      await registeredHooks.taskComplete({
        taskId: 'task-1',
        task: makeTask({ isDone: true }),
      });

      expect(logDebugMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('does not allow done trigger when mode is onStop', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'onStop' });
      requestMock.mockResolvedValue({ ok: true });

      await registeredHooks.taskComplete({
        taskId: 'task-1',
        task: makeTask({ isDone: true }),
      });

      expect(logDebugMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('does not allow stop trigger when mode is onDone', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'onDone' });
      requestMock.mockResolvedValue({ ok: true });

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });

      expect(logDebugMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('ignores hook events for tasks from other issue providers', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockResolvedValue({ ok: true });

      await registeredHooks.currentTaskChange({
        previous: makeTask({
          issueType: 'plugin:other-provider',
          issueId: '101',
        }),
        current: null,
      });
      await registeredHooks.taskComplete({
        taskId: 'task-2',
        task: makeTask({
          id: 'task-2',
          issueType: 'JIRA',
          issueId: 'PROJ-1',
        }),
      });

      expect(logDebugMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });
  });

  describe('delta computation and watermark', () => {
    const makeTask = (overrides: Partial<Task> = {}): Task =>
      ({
        id: 'task-1',
        title: 'Tracked todo',
        timeEstimate: 0,
        timeSpent: 3600000,
        isDone: false,
        projectId: 'project-1',
        tagIds: [],
        created: 1,
        subTaskIds: [],
        issueId: '101',
        issueType: 'plugin:basecamp-issue-provider',
        issueProviderId: 'provider-1',
        timeSpentOnDay: { '2026-07-01': 3600000 },
        ...overrides,
      }) as Task;

    it('computes positive deltas from timeSpentOnDay minus watermark', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockResolvedValue({ ok: true });

      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      watermarkStoreForTests.set(key, 1800000); // 30 min already pushed

      await registeredHooks.currentTaskChange({
        previous: makeTask({ timeSpentOnDay: { '2026-07-01': 3600000 } }), // 1h tracked
        current: null,
      });

      expect(logDebugMock).toHaveBeenCalledWith(
        '[basecamp-issue-provider] Time pushed successfully',
        expect.objectContaining({
          date: '2026-07-01',
          deltaMs: 1800000,
        }),
      );
    });

    it('skips dates where tracked equals watermark (zero delta)', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      watermarkStoreForTests.set(key, 3600000);

      await registeredHooks.currentTaskChange({
        previous: makeTask({ timeSpentOnDay: { '2026-07-01': 3600000 } }),
        current: null,
      });

      expect(logDebugMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('skips dates where tracked is less than watermark (negative delta)', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      watermarkStoreForTests.set(key, 7200000);

      await registeredHooks.currentTaskChange({
        previous: makeTask({ timeSpentOnDay: { '2026-07-01': 3600000 } }),
        current: null,
      });

      expect(logDebugMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('returns only positive deltas across multiple dates', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockResolvedValue({ ok: true });

      const keyJul1 = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      watermarkStoreForTests.set(keyJul1, 3600000); // fully pushed

      await registeredHooks.currentTaskChange({
        previous: makeTask({
          timeSpentOnDay: {
            '2026-07-01': 3600000, // equal to watermark → no delta
            '2026-07-02': 1800000, // no watermark → 1800000 delta
          },
        }),
        current: null,
      });

      expect(logDebugMock).toHaveBeenCalledWith(
        '[basecamp-issue-provider] Time pushed successfully',
        expect.objectContaining({
          date: '2026-07-02',
          deltaMs: 1800000,
        }),
      );
    });

    it('returns empty deltas when timeSpentOnDay is undefined', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });

      await registeredHooks.currentTaskChange({
        previous: makeTask({ timeSpentOnDay: undefined }),
        current: null,
      });

      expect(logDebugMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('returns empty deltas when timeSpentOnDay is empty', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });

      await registeredHooks.currentTaskChange({
        previous: makeTask({ timeSpentOnDay: {} }),
        current: null,
      });

      expect(logDebugMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('scopes watermarks by accountId so different cached configs do not collide', async () => {
      // Two different cached configs for same todo but different accountIds
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });

      requestMock.mockResolvedValue({ ok: true });

      // Push watermark for acc-123
      const keyAcc123 = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      watermarkStoreForTests.set(keyAcc123, 3600000);

      // Same todoId but different accountId via provider config update → no watermark for acc-456 → full delta
      providerConfigStoreForTests.set('101', { accountId: 'acc-456', timeTracking: 'both' });

      await registeredHooks.currentTaskChange({
        previous: makeTask({
          timeSpentOnDay: { '2026-07-01': 3600000 },
        }),
        current: null,
      });

      expect(logDebugMock).toHaveBeenCalledWith(
        '[basecamp-issue-provider] Time pushed successfully',
        expect.objectContaining({
          date: '2026-07-01',
          deltaMs: 3600000,
        }),
      );
      // Verify the POST used acc-456
      expect(requestMock).toHaveBeenCalledWith(
        'https://3.basecampapi.com/acc-456/recordings/101/timesheet/entries.json',
        expect.anything(),
      );
    });
  });

  describe('time tracking POST logic', () => {
    const makeTask = (overrides: Partial<Task> = {}): Task =>
      ({
        id: 'task-1',
        title: 'Tracked todo',
        timeEstimate: 0,
        timeSpent: 3600000,
        isDone: false,
        projectId: 'project-1',
        tagIds: [],
        created: 1,
        subTaskIds: [],
        issueId: '101',
        issueType: 'plugin:basecamp-issue-provider',
        issueProviderId: 'provider-1',
        timeSpentOnDay: { '2026-07-01': 5400000 }, // 1.5 hours
        ...overrides,
      }) as Task;

    it('POSTs positive deltas to the Basecamp timesheet API and updates the watermark', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockResolvedValue({ ok: true });

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });

      // Verify POST call
      expect(requestMock).toHaveBeenCalledWith(
        'https://3.basecampapi.com/acc-123/recordings/101/timesheet/entries.json',
        expect.objectContaining({
          method: 'POST',
          body: { date: '2026-07-01', hours: '1.50' },
        }),
      );

      // Verify watermark was updated
      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      expect(watermarkStoreForTests.get(key)).toBe(5400000);
      expect(persistDataSyncedMock).toHaveBeenCalledWith(
        expect.any(String),
        'basecamp_time_watermarks',
      );
    });

    it('does not update the watermark if the POST fails', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockRejectedValue(new Error('Network Error'));

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });

      // Watermark should remain undefined/0
      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      expect(watermarkStoreForTests.get(key)).toBeUndefined();
    });

    it('shows snackbar and updates watermark if POST fails with 403', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockRejectedValue(Object.assign(new Error(), { status: 403 }));

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });

      expect(showSnackMock).toHaveBeenCalledWith({
        msg: 'Basecamp: Timesheets are unavailable or inaccessible for this project. Time tracking is ignored.',
        type: 'ERROR',
        ico: 'error',
      });
      // Watermark should remain undefined/unchanged
      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      expect(watermarkStoreForTests.get(key)).toBeUndefined();
      expect(persistDataSyncedMock).not.toHaveBeenCalled();
    });

    it('shows snackbar and does not update watermark if POST fails with 404', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockRejectedValue(Object.assign(new Error(), { status: 404 }));

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });

      expect(showSnackMock).toHaveBeenCalledWith({
        msg: 'Basecamp: Timesheets are unavailable or inaccessible for this project. Time tracking is ignored.',
        type: 'ERROR',
        ico: 'error',
      });
      // Watermark should remain undefined/unchanged
      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      expect(watermarkStoreForTests.get(key)).toBeUndefined();
      expect(persistDataSyncedMock).not.toHaveBeenCalled();
    });

    it('shows snackbar and does not update watermark if POST fails with 422', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockRejectedValue(Object.assign(new Error(), { status: 422 }));

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });

      expect(showSnackMock).toHaveBeenCalledWith({
        msg: 'Basecamp: Timesheet validation or configuration failed. Time tracking is paused until resolved.',
        type: 'ERROR',
        ico: 'error',
      });

      // Watermark should remain undefined/unchanged
      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      expect(watermarkStoreForTests.get(key)).toBeUndefined();

      // Data should not be persisted since the watermark didn't change
      expect(persistDataSyncedMock).not.toHaveBeenCalled();
    });

    it('shows snackbar and does not update watermark if POST fails with 429', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockRejectedValue(Object.assign(new Error(), { status: 429 }));

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });

      expect(showSnackMock).toHaveBeenCalledWith({
        msg: 'Basecamp: Rate limited by the server. Time tracking will be retried later.',
        type: 'ERROR',
        ico: 'error',
      });

      // Watermark should remain undefined/unchanged
      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      expect(watermarkStoreForTests.get(key)).toBeUndefined();

      // Data should not be persisted since the watermark didn't change
      expect(persistDataSyncedMock).not.toHaveBeenCalled();
    });

    it('skips push if accountId is missing in cached config', async () => {
      // Set a config with no accountId (empty string or missing)
      providerConfigStoreForTests.set('101', { accountId: '', timeTracking: 'both' });

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });

      expect(requestMock).not.toHaveBeenCalled();
    });

    it('does not POST if postedHours < 0.01 (rounding granularity) and leaves watermark unchanged', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockResolvedValue({ ok: true });

      const task = makeTask({
        timeSpentOnDay: { '2026-07-01': 30000 }, // 30s = 0.00833h < 0.01h
      });

      await registeredHooks.currentTaskChange({
        previous: task,
        current: null,
      });

      // Should NOT call POST since postedHours < 0.01
      expect(requestMock).not.toHaveBeenCalled();
      // Watermark should NOT be advanced
      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      expect(watermarkStoreForTests.get(key)).toBeUndefined();
      expect(persistDataSyncedMock).not.toHaveBeenCalled();
    });

    it('accumulates time across calls until postedHours >= 0.01 (rollover test)', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockResolvedValue({ ok: true });

      // First call: 18000ms (5s < 0.01h). Watermark unchanged, no POST.
      await registeredHooks.currentTaskChange({
        previous: makeTask({
          timeSpentOnDay: { '2026-07-01': 18000 },
        }),
        current: null,
      });

      expect(requestMock).not.toHaveBeenCalled();
      let key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      expect(watermarkStoreForTests.get(key)).toBeUndefined();

      // Second call: 36000ms (10s accumulated from prior time = exactly 0.01h). Should POST.
      // Note: Fresh watermark load needed, simulating async persistence flow
      await registeredHooks.currentTaskChange({
        previous: makeTask({
          timeSpentOnDay: { '2026-07-01': 36000 }, // 10s = 0.01h exactly
        }),
        current: null,
      });

      expect(requestMock).toHaveBeenCalledWith(
        'https://3.basecampapi.com/acc-123/recordings/101/timesheet/entries.json',
        expect.objectContaining({
          method: 'POST',
          body: { date: '2026-07-01', hours: '0.01' },
        }),
      );

      // Watermark should be advanced by 36000ms (the posted amount)
      key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      expect(watermarkStoreForTests.get(key)).toBe(36000);
    });

    it('shows snackbar and does not update watermark if POST fails with 503', async () => {
      providerConfigStoreForTests.set('101', { accountId: 'acc-123', timeTracking: 'both' });
      requestMock.mockRejectedValue(Object.assign(new Error(), { status: 503 }));

      await registeredHooks.currentTaskChange({
        previous: makeTask(),
        current: null,
      });

      expect(showSnackMock).toHaveBeenCalledWith({
        msg: 'Basecamp: Rate limited by the server. Time tracking will be retried later.',
        type: 'ERROR',
        ico: 'error',
      });

      // Watermark should remain undefined/unchanged
      const key = watermarkStoreForTests.getKey('acc-123', '101', '2026-07-01');
      expect(watermarkStoreForTests.get(key)).toBeUndefined();

      // Data should not be persisted since the watermark didn't change
      expect(persistDataSyncedMock).not.toHaveBeenCalled();
    });
  });

  describe('OAuth config', () => {
    describe('advanced OAuth overrides', () => {
      it('exposes optional advanced fields for a user-provided Basecamp OAuth app', () => {
        // BYO credentials are namespaced under oauthOverrides.* so the host reads them
        // from pluginConfig.oauthOverrides (see #8546 applyPluginOAuthOverrides).
        const keys = definition.configFields.map((field) => field.key);
        expect(keys).toContain('oauthOverrides.clientId');
        expect(keys).toContain('oauthOverrides.clientSecret');
        expect(keys).toContain('oauthOverrides.redirectUri');

        const clientIdField = definition.configFields.find(
          (field) => field.key === 'oauthOverrides.clientId',
        )!;
        const clientSecretField = definition.configFields.find(
          (field) => field.key === 'oauthOverrides.clientSecret',
        )!;
        const redirectField = definition.configFields.find(
          (field) => field.key === 'oauthOverrides.redirectUri',
        )!;

        expect(clientIdField.advanced).toBe(true);
        expect(clientSecretField.advanced).toBe(true);
        expect(redirectField.advanced).toBe(true);

        // the secret must render masked, not as a plain text input
        expect(clientSecretField.type).toBe('password');
        expect(clientIdField.type).toBe('input');
        expect(redirectField.type).toBe('input');
      });
    });

    it('declares the Launchpad oauthButton with public client metadata', () => {
      const oauthField = definition.configFields.find((field) => field.key === 'oauth');
      const oauthConfig = oauthField?.oauthConfig;

      expect(oauthField?.type).toBe('oauthButton');
      expect(oauthConfig).toMatchObject({
        authUrl: 'https://launchpad.37signals.com/authorization/new',
        tokenUrl: 'https://launchpad.37signals.com/authorization/token',
        clientId: 'YOUR_BASECAMP_CLIENT_ID',
        clientSecret: 'YOUR_BASECAMP_CLIENT_SECRET',
        redirectUri: 'http://127.0.0.1:8976/callback',
        scopes: ['full'],
        extraAuthParams: { type: 'web_server' },
      });
    });
  });

  describe('getHeaders', () => {
    it('returns Bearer auth headers from PluginAPI.getOAuthToken()', async () => {
      const headers = await definition.getHeaders({});
      expect(headers).toEqual({
        Authorization: 'Bearer mock-token',
        Accept: 'application/json',
      });
    });

    it('throws a clear error when no OAuth token exists', async () => {
      getOAuthTokenMock.mockResolvedValueOnce(null);
      await expect(definition.getHeaders({})).rejects.toThrow('Basecamp: Not authenticated. Please connect your account.');
    });
  });

  describe('authenticated POST helper', () => {
    it('posts JSON with Bearer auth and returns parsed JSON', async () => {
      requestMock.mockResolvedValue({ ok: true, entryId: 123 });

      const response = await postAuthenticatedJsonForTests<{
        ok: boolean;
        entryId: number;
      }>('https://example.test/timesheet/entries.json', {
        date: '2026-07-01',
        hours: '1.50',
      });

      expect(getOAuthTokenMock).toHaveBeenCalledTimes(1);
      expect(requestMock).toHaveBeenCalledWith(
        'https://example.test/timesheet/entries.json',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer mock-token',
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: {
            date: '2026-07-01',
            hours: '1.50',
          },
        },
      );
      expect(response).toEqual({ ok: true, entryId: 123 });
    });

    it('returns undefined for an empty successful response body', async () => {
      requestMock.mockResolvedValue(null);

      await expect(
        postAuthenticatedJsonForTests('https://example.test/timesheet/entries.json', {
          date: '2026-07-01',
          hours: '0.25',
        }),
      ).resolves.toBeUndefined();
    });

    it('fails before the host request when no OAuth token exists', async () => {
      getOAuthTokenMock.mockResolvedValueOnce(null);

      await expect(
        postAuthenticatedJsonForTests('https://example.test/timesheet/entries.json', {}),
      ).rejects.toThrow('Basecamp: Not authenticated. Please connect your account.');
      expect(requestMock).not.toHaveBeenCalled();
    });

    it('throws an error carrying the HTTP status for non-2xx responses', async () => {
      requestMock.mockRejectedValue({
        status: 422,
        error: { error: 'validation failed' },
      });

      await expect(
        postAuthenticatedJsonForTests('https://example.test/timesheet/entries.json', {
          hours: '0.00',
        }),
      ).rejects.toMatchObject({
        message: 'HTTP 422',
        status: 422,
        responseBody: JSON.stringify({ error: 'validation failed' }),
      });
    });
  });

  describe('account picker', () => {
    it('filters authorization accounts to bc3 and auto-selects a single account', async () => {
      const accountField = definition.configFields.find(
        (field) => field.key === 'accountId',
      )!;
      const http = makeHttp();
      http.get.mockResolvedValue({
        accounts: [
          { id: 111, name: 'Basecamp One', product: 'bc3' },
          { id: 222, name: 'Campfire', product: 'campfire' },
        ],
      });
      const config: Record<string, unknown> = {};

      const options = await accountField.loadOptions!(config, http as any);

      expect(http.get).toHaveBeenCalledWith(
        'https://launchpad.37signals.com/authorization.json',
      );
      expect(options).toEqual([{ label: 'Basecamp One (111)', value: '111' }]);
      expect(config.accountId).toBe('111');
    });

    it('does not override an existing account selection', async () => {
      const accountField = definition.configFields.find(
        (field) => field.key === 'accountId',
      )!;
      const http = makeHttp();
      http.get.mockResolvedValue({
        accounts: [{ id: 111, name: 'Basecamp One', product: 'bc3' }],
      });
      const config: Record<string, unknown> = { accountId: '999' };

      await accountField.loadOptions!(config, http as any);

      expect(config.accountId).toBe('999');
    });

    it('returns no account options when the response is null', async () => {
      const accountField = definition.configFields.find(
        (field) => field.key === 'accountId',
      )!;
      const http = makeHttp();
      http.get.mockResolvedValue(null);

      const options = await accountField.loadOptions!({}, http as any);

      expect(options).toEqual([]);
    });
  });

  describe('project picker', () => {
    it('loads account-scoped projects for the selected account', async () => {
      const projectField = definition.configFields.find(
        (field) => field.key === 'bucketId',
      )!;
      const http = makeHttp();
      http.get.mockResolvedValue([
        { id: 10, name: 'Project Alpha' },
        { id: 11, name: 'Project Beta' },
      ]);

      const options = await projectField.loadOptions!(
        { accountId: '1234567' },
        http as any,
      );

      expect(http.get).toHaveBeenCalledWith(
        'https://3.basecampapi.com/1234567/projects.json',
      );
      expect(options).toEqual([
        { label: 'Project Alpha', value: '10' },
        { label: 'Project Beta', value: '11' },
      ]);
    });

    it('returns no project options when accountId is missing', async () => {
      const projectField = definition.configFields.find(
        (field) => field.key === 'bucketId',
      )!;
      const http = makeHttp();

      const options = await projectField.loadOptions!({}, http as any);

      expect(options).toEqual([]);
      expect(http.get).not.toHaveBeenCalled();
    });
  });

  describe('todolist picker', () => {
    it('loads account-scoped todolists for the selected project', async () => {
      const todolistField = definition.configFields.find(
        (field) => field.key === 'todolistId',
      )!;
      const http = makeHttp();
      http.get
        .mockResolvedValueOnce({
          id: 42,
          name: 'Project Alpha',
          dock: [{ name: 'todoset', id: 9002 }],
        })
        .mockResolvedValueOnce([{ id: 77, title: 'My List' }]);

      const options = await todolistField.loadOptions!(
        { accountId: '1234567', bucketId: '42' },
        http as any,
      );

      expect(http.get).toHaveBeenNthCalledWith(
        1,
        'https://3.basecampapi.com/1234567/projects/42.json',
      );
      expect(http.get).toHaveBeenNthCalledWith(
        2,
        'https://3.basecampapi.com/1234567/todosets/9002/todolists.json',
      );
      expect(options).toEqual([{ label: 'My List', value: '77' }]);
    });

    it('returns no todolist options when bucketId is missing', async () => {
      const todolistField = definition.configFields.find(
        (field) => field.key === 'todolistId',
      )!;
      const http = makeHttp();

      const options = await todolistField.loadOptions!(
        { accountId: '1234567' },
        http as any,
      );

      expect(options).toEqual([]);
      expect(http.get).not.toHaveBeenCalled();
    });

    it('returns no todolist options when the project response is null', async () => {
      const todolistField = definition.configFields.find(
        (field) => field.key === 'todolistId',
      )!;
      const http = makeHttp();
      http.get.mockResolvedValueOnce(null);

      const options = await todolistField.loadOptions!(
        { accountId: '1234567', bucketId: '42' },
        http as any,
      );

      expect(options).toEqual([]);
    });
  });

  describe('config field dependencies', () => {
    it('cascades the project and todolist pickers via showIf', () => {
      const bucketField = definition.configFields.find((f) => f.key === 'bucketId')!;
      const todolistField = definition.configFields.find((f) => f.key === 'todolistId')!;

      expect(bucketField.showIf).toBe('accountId');
      expect(todolistField.showIf).toBe('bucketId');
    });

    it('exposes advanced time-tracking mode selection', () => {
      const timeTrackingField = definition.configFields.find(
        (field) => field.key === 'timeTracking',
      )!;

      expect(timeTrackingField).toMatchObject({
        type: 'select',
        label: 'Time tracking',
        description: 'Controls when Super Productivity tracked time is posted to Basecamp timesheet entries. Defaults to posting on stop and done.',
        required: false,
        advanced: true,
      });
      expect(timeTrackingField.options).toEqual([
        { label: 'On stop and done', value: 'both' },
        { label: 'On stop', value: 'onStop' },
        { label: 'On done', value: 'onDone' },
        { label: 'Off', value: 'off' },
      ]);
    });
  });

  describe('todo import and display', () => {
    const makeTodo = (overrides: Record<string, unknown> = {}) => ({
      id: 101,
      content: 'Review pull request',
      description: 'Check the latest changes',
      completed: false,
      app_url: 'https://3.basecamp.com/1234567/buckets/42/todos/101',
      url: 'https://3.basecampapi.com/1234567/todos/101.json',
      updated_at: '2026-06-19T01:02:03Z',
      created_at: '2026-06-18T01:02:03Z',
      ...overrides,
    });

    const cfg = {
      accountId: '1234567',
      bucketId: '42',
      todolistId: '77',
    };

    it('imports open todos from the configured todolist for backlog', async () => {
      const http = makeHttp();
      http.get.mockResolvedValueOnce([
        makeTodo(),
        makeTodo({ id: 102, content: 'Done todo', completed: true }),
      ]);

      const results = await definition.getNewIssuesForBacklog!(cfg, http as any);

      expect(http.get).toHaveBeenCalledWith(
        'https://3.basecampapi.com/1234567/buckets/42/todolists/77/todos.json?page=1',
      );
      expect(results).toEqual([
        {
          id: '101',
          title: 'Review pull request',
          url: 'https://3.basecamp.com/1234567/buckets/42/todos/101',
          status: 'active',
          description: 'Check the latest changes',
          body: 'Check the latest changes',
          completed: false,
        },
      ]);
    });

    it('filters search results by content and description', async () => {
      const http = makeHttp();
      http.get.mockResolvedValueOnce([
        makeTodo(),
        makeTodo({ id: 202, content: 'Plan roadmap', description: 'Quarterly planning' }),
      ]);

      const results = await definition.searchIssues('quarterly', cfg, http as any);

      expect(results).toEqual([
        {
          id: '202',
          title: 'Plan roadmap',
          url: 'https://3.basecamp.com/1234567/buckets/42/todos/101',
          status: 'active',
          description: 'Quarterly planning',
          body: 'Quarterly planning',
          completed: false,
        },
      ]);
    });

    it('fetches a single todo as a PluginIssue', async () => {
      const http = makeHttp();
      http.get.mockResolvedValueOnce(makeTodo({ id: 333, content: 'Ship release' }));

      const issue = await definition.getById('333', cfg, http as any);

      expect(http.get).toHaveBeenCalledWith(
        'https://3.basecampapi.com/1234567/todos/333.json',
      );
      expect(issue).toEqual({
        id: '333',
        title: 'Ship release',
        body: 'Check the latest changes',
        url: 'https://3.basecamp.com/1234567/buckets/42/todos/101',
        state: 'active',
        completed: false,
        lastUpdated: new Date('2026-06-19T01:02:03Z').getTime(),
      });
    });

    it('imports Basecamp due_on as dueDay and keeps the raw description as body', async () => {
      const http = makeHttp();
      http.get.mockResolvedValueOnce(
        makeTodo({
          id: 444,
          content: 'With due + notes',
          description: '<div>line one<br>line two</div>',
          due_on: '2026-07-15',
        }),
      );

      const issue = await definition.getById('444', cfg, http as any);

      expect(issue).toMatchObject({
        id: '444',
        body: '<div>line one<br>line two</div>',
        dueDay: '2026-07-15',
      });
    });

    it('surfaces dueDay on backlog search results when due_on is set', async () => {
      const http = makeHttp();
      http.get.mockResolvedValueOnce([makeTodo({ id: 555, due_on: '2026-08-01' })]);

      const results = await definition.getNewIssuesForBacklog!(cfg, http as any);
      expect(results[0]).toMatchObject({ id: '555', dueDay: '2026-08-01' });
    });

    it('maps notes import-only from the Basecamp description as Markdown', () => {
      const m = definition.fieldMappings?.find((x) => x.taskField === 'notes');
      expect(m).toMatchObject({ issueField: 'body', defaultDirection: 'pullOnly' });
      const md = (html: string): unknown => m?.toTaskValue?.(html, { issueId: '1' } as any);

      expect(md('<div>Review the <strong>PR</strong> &amp; <em>merge</em></div>')).toBe(
        'Review the **PR** & *merge*',
      );
      expect(md('<a href="https://ex.com/x"><strong>link</strong></a>')).toBe(
        '[**link**](https://ex.com/x)',
      );
      expect(md('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two');
      expect(md('<ol><li>a</li><li>b</li></ol>')).toBe('1. a\n2. b');
      expect(md('<h1>Title</h1>')).toBe('# Title');
      expect(md('<blockquote>quote me</blockquote>')).toBe('> quote me');
      expect(md('<del>gone</del>')).toBe('~~gone~~');
      expect(md('line1<br>line2')).toBe('line1\nline2');
      expect(md('')).toBe('');
    });

    it('maps a Basecamp attachment figure to a Markdown link', () => {
      const m = definition.fieldMappings?.find((x) => x.taskField === 'notes');
      expect(
        m?.toTaskValue?.(
          '<figure data-trix-attachment><img src="https://f/x.png"><figcaption>diagram</figcaption></figure>',
          { issueId: '1' } as any,
        ),
      ).toBe('[diagram](https://f/x.png)');
    });

    it('maps dueDay two-way with the Basecamp due date', () => {
      const m = definition.fieldMappings?.find((x) => x.taskField === 'dueDay');
      expect(m).toMatchObject({ issueField: 'dueDay', defaultDirection: 'both' });
      expect(m?.toTaskValue?.('2026-07-15', { issueId: '1' } as any)).toBe('2026-07-15');
      expect(m?.toTaskValue?.('', { issueId: '1' } as any)).toBeUndefined();
      expect(m?.toIssueValue?.('2026-07-15', { issueId: '1' } as any)).toBe('2026-07-15');
      expect(m?.toIssueValue?.('', { issueId: '1' } as any)).toBeUndefined();
    });

    it('keeps notes import-only (not written back to Basecamp)', () => {
      const m = definition.fieldMappings?.find((x) => x.taskField === 'notes');
      expect(m).toMatchObject({ defaultDirection: 'pullOnly' });
    });

    it('paginates backlog import until a short page', async () => {
      const http = makeHttp();
      http.get
        .mockResolvedValueOnce(
          Array.from({ length: 50 }, (_, i) =>
            makeTodo({ id: i + 1, content: `Todo ${i + 1}` }),
          ),
        )
        .mockResolvedValueOnce([makeTodo({ id: 51, content: 'Todo 51' })]);

      const results = await definition.getNewIssuesForBacklog!(cfg, http as any);

      expect(http.get).toHaveBeenNthCalledWith(
        1,
        'https://3.basecampapi.com/1234567/buckets/42/todolists/77/todos.json?page=1',
      );
      expect(http.get).toHaveBeenNthCalledWith(
        2,
        'https://3.basecampapi.com/1234567/buckets/42/todolists/77/todos.json?page=2',
      );
      expect(results).toHaveLength(51);
      expect(results[50].id).toBe('51');
    });

    it('warns when pagination hits the configured page cap', async () => {
      const http = makeHttp();
      const page = Array.from({ length: 50 }, (_, i) =>
        makeTodo({ id: i + 1, content: `Todo ${i + 1}` }),
      );
      http.get.mockResolvedValue(page);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const results = await definition.getNewIssuesForBacklog!(cfg, http as any);

      expect(http.get).toHaveBeenCalledTimes(20);
      expect(results).toHaveLength(1000);
      expect(warnSpy).toHaveBeenCalledWith(
        '[basecamp-issue-provider] Todo import capped at 20 pages for todolist 77',
      );
      warnSpy.mockRestore();
    });

    it('caches the all-todos fetch within the TTL', async () => {
      // Use unique config to avoid cross-test cache contamination
      const uniqueCfg = {
        accountId: '9999999',
        bucketId: '9999',
        todolistId: '9999',
      };
      const http = makeHttp();
      http.get.mockResolvedValue([makeTodo({ id: 101, content: 'Cached todo' })]);

      // First call should fetch from HTTP
      const results1 = await definition.getNewIssuesForBacklog!(uniqueCfg, http as any);
      expect(http.get).toHaveBeenCalledTimes(1);
      expect(results1).toHaveLength(1);

      // Second call within TTL should NOT call http.get again
      const results2 = await definition.getNewIssuesForBacklog!(uniqueCfg, http as any);
      expect(http.get).toHaveBeenCalledTimes(1); // Still 1, not 2
      expect(results2).toEqual(results1);
    });

    it('builds the Basecamp todo permalink from account and bucket config', () => {
      expect(definition.getIssueLink('101', cfg)).toBe(
        'https://3.basecamp.com/1234567/buckets/42/todos/101',
      );
    });

    it('throws matching ERRORS.MISSING_* key when required config is missing', async () => {
      const http = makeHttp();

      // Missing accountId
      await expect(
        definition.searchIssues(
          'test',
          { bucketId: '42', todolistId: '77' },
          http as any,
        ),
      ).rejects.toThrow('Basecamp: No account selected.');

      // Missing bucketId
      await expect(
        definition.searchIssues(
          'test',
          { accountId: '1234567', todolistId: '77' },
          http as any,
        ),
      ).rejects.toThrow('Basecamp: No project selected.');

      // Missing todolistId
      await expect(
        definition.searchIssues(
          'test',
          { accountId: '1234567', bucketId: '42' },
          http as any,
        ),
      ).rejects.toThrow('Basecamp: No to-do list selected.');
    });
  });

  describe('done sync', () => {
    const cfg = {
      accountId: '1234567',
      bucketId: '42',
      todolistId: '77',
    };

    it('declares an isDone mapping backed by Basecamp completed state', () => {
      const doneMapping = definition.fieldMappings?.find(
        (mapping) => mapping.taskField === 'isDone',
      );

      expect(doneMapping).toBeDefined();
      expect(doneMapping).toMatchObject({
        issueField: 'completed',
        defaultDirection: 'both',
      });
      expect(doneMapping?.toIssueValue?.(true, { issueId: '101' } as any)).toBe(true);
      expect(doneMapping?.toIssueValue?.(false, { issueId: '101' } as any)).toBe(false);
      expect(doneMapping?.toTaskValue?.(true, { issueId: '101' } as any)).toBe(true);
      expect(doneMapping?.toTaskValue?.(false, { issueId: '101' } as any)).toBe(false);
    });

    it('posts completion when completed becomes true', async () => {
      const http = makeHttp();
      http.post.mockResolvedValue({});

      await definition.updateIssue!('101', { completed: true }, cfg, http as any);

      expect(http.post).toHaveBeenCalledWith(
        'https://3.basecampapi.com/1234567/todos/101/completion.json',
        {},
      );
      expect(http.delete).not.toHaveBeenCalled();
    });

    it('deletes completion when completed becomes false', async () => {
      const http = makeHttp();
      http.delete.mockResolvedValue({});

      await definition.updateIssue!('101', { completed: false }, cfg, http as any);

      expect(http.delete).toHaveBeenCalledWith(
        'https://3.basecampapi.com/1234567/todos/101/completion.json',
      );
      expect(http.post).not.toHaveBeenCalled();
    });

    it('does nothing when completed is absent from changes', async () => {
      const http = makeHttp();

      await definition.updateIssue!('101', { title: 'Rename only' }, cfg, http as any);

      expect(http.post).not.toHaveBeenCalled();
      expect(http.delete).not.toHaveBeenCalled();
      expect(http.put).not.toHaveBeenCalled();
    });

    it('writes the due date back (fetches content first, then PUTs) — two-way', async () => {
      const http = makeHttp();
      http.get.mockResolvedValueOnce({ id: 101, content: 'Ship release' });
      http.put.mockResolvedValue({});

      await definition.updateIssue!('101', { dueDay: '2026-09-01' }, cfg, http as any);

      expect(http.get).toHaveBeenCalledWith(
        'https://3.basecampapi.com/1234567/todos/101.json',
      );
      expect(http.put).toHaveBeenCalledWith(
        'https://3.basecampapi.com/1234567/todos/101.json',
        { content: 'Ship release', due_on: '2026-09-01' },
      );
    });

    it('clears the due date (due_on: null) when dueDay is empty', async () => {
      const http = makeHttp();
      http.get.mockResolvedValueOnce({ id: 101, content: 'Ship release' });
      http.put.mockResolvedValue({});

      await definition.updateIssue!('101', { dueDay: '' }, cfg, http as any);

      expect(http.put).toHaveBeenCalledWith(
        'https://3.basecampapi.com/1234567/todos/101.json',
        { content: 'Ship release', due_on: null },
      );
    });

    it('refuses to write due date when the todo content cannot be read (no title clobber)', async () => {
      const http = makeHttp();
      http.get.mockResolvedValueOnce({ id: 101 });

      await expect(
        definition.updateIssue!('101', { dueDay: '2026-09-01' }, cfg, http as any),
      ).rejects.toThrow(/unable to read the todo content/);
      expect(http.put).not.toHaveBeenCalled();
    });
  });

  describe('todolist picker', () => {
    it('loads todolists from the selected project todoset', async () => {
      const todolistField = definition.configFields.find(
        (field) => field.key === 'todolistId',
      )!;
      const http = makeHttp();
      http.get
        .mockResolvedValueOnce({
          id: 42,
          name: 'Project Alpha',
          dock: [
            { id: 9001, name: 'message_board', title: 'Message Board' },
            {
              name: 'todoset',
              title: 'To-dos',
              url: 'https://3.basecampapi.com/1234567/buckets/42/todosets/9002.json',
              app_url: 'https://3.basecamp.com/1234567/buckets/42/todosets/9002',
            },
          ],
        })
        .mockResolvedValueOnce([
          { id: 501, title: 'Product backlog' },
          { id: 502, title: 'Sprint list' },
        ]);

      const options = await todolistField.loadOptions!(
        { accountId: '1234567', bucketId: '42' },
        http as any,
      );

      expect(http.get).toHaveBeenNthCalledWith(
        1,
        'https://3.basecampapi.com/1234567/projects/42.json',
      );
      expect(http.get).toHaveBeenNthCalledWith(
        2,
        'https://3.basecampapi.com/1234567/todosets/9002/todolists.json',
      );
      expect(options).toEqual([
        { label: 'Product backlog', value: '501' },
        { label: 'Sprint list', value: '502' },
      ]);
    });

    it('returns no todolist options when the todoset dock entry has no usable id or url', async () => {
      const todolistField = definition.configFields.find(
        (field) => field.key === 'todolistId',
      )!;
      const http = makeHttp();
      http.get.mockResolvedValue({
        id: 42,
        name: 'Project Alpha',
        dock: [{ name: 'todoset', title: 'To-dos' }],
      });

      const options = await todolistField.loadOptions!(
        { accountId: '1234567', bucketId: '42' },
        http as any,
      );

      expect(options).toEqual([]);
      expect(http.get).toHaveBeenCalledTimes(1);
    });

    it('returns no todolist options when accountId or bucketId is missing', async () => {
      const todolistField = definition.configFields.find(
        (field) => field.key === 'todolistId',
      )!;
      const http = makeHttp();

      await expect(
        todolistField.loadOptions!({ accountId: '1234567' }, http as any),
      ).resolves.toEqual([]);
      await expect(
        todolistField.loadOptions!({ bucketId: '42' }, http as any),
      ).resolves.toEqual([]);
      expect(http.get).not.toHaveBeenCalled();
    });

    it('returns no todolist options when the project has no todoset dock entry', async () => {
      const todolistField = definition.configFields.find(
        (field) => field.key === 'todolistId',
      )!;
      const http = makeHttp();
      http.get.mockResolvedValue({ id: 42, name: 'Project Alpha', dock: [] });

      const options = await todolistField.loadOptions!(
        { accountId: '1234567', bucketId: '42' },
        http as any,
      );

      expect(options).toEqual([]);
      expect(http.get).toHaveBeenCalledTimes(1);
    });
  });
});

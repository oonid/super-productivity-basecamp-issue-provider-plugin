import type {
  IssueProviderPluginDefinition,
  OAuthFlowConfig,
  PluginFieldMapping,
  PluginHttp,
  PluginRequestOptions,
  PluginSearchResult,
  Task,
} from '@super-productivity/plugin-api';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  registerHook(
    hook: 'currentTaskChange' | 'taskComplete' | 'persistedDataChanged',
    handler: (payload: unknown) => void | Promise<void>,
  ): void;
  translate(key: string, params?: Record<string, string | number>): string;
  startOAuthFlow(config: OAuthFlowConfig): Promise<unknown>;
  getOAuthToken(): Promise<string | null>;
  request<T = unknown>(url: string, options?: PluginRequestOptions): Promise<T>;
  getConfig<T = Record<string, unknown>>(): Promise<T | null>;
  loadSyncedData(key?: string): Promise<string | null>;
  persistDataSynced(dataStr: string, key?: string): Promise<void>;
  onReady?(fn: () => void | Promise<void>): void;
  showSnack?(opts: { msg: string; type?: 'ERROR' | 'SUCCESS' | 'INFO'; ico?: string }): void;
  log?: {
    debug?: (...args: unknown[]) => void;
  };
};

const BASECAMP_AUTH_URL = 'https://launchpad.37signals.com/authorization/new';
const BASECAMP_TOKEN_URL = 'https://launchpad.37signals.com/authorization/token';
const BASECAMP_AUTHORIZATION_URL = 'https://launchpad.37signals.com/authorization.json';
const BASECAMP_API_BASE = 'https://3.basecampapi.com';
const BASECAMP_SCOPE = 'full';
const BASECAMP_REDIRECT_URI = 'http://127.0.0.1:8976/callback';
const BASECAMP_TODOS_PAGE_SIZE = 50;
const BASECAMP_TODOS_PAGE_CAP = 20;
const BASECAMP_ISSUE_PROVIDER_KEY = 'plugin:basecamp-issue-provider';
const HOOK_CURRENT_TASK_CHANGE = 'currentTaskChange';
const HOOK_TASK_COMPLETE = 'taskComplete';
const WATERMARK_STORAGE_KEY = 'basecamp_time_watermarks';
const HOOK_PERSISTED_DATA_CHANGED = 'persistedDataChanged';
// Public OAuth client metadata, injected at build time via esbuild `define` from the
// BASECAMP_CLIENT_ID / BASECAMP_CLIENT_SECRET build env (see scripts/build.js). Falls back to
// placeholders so the plugin source carries no real credentials. Users can supply their own
// Basecamp OAuth app via the advanced oauthOverrides.{clientId,clientSecret,redirectUri}
// config fields below — the host reads bring-your-own credentials from
// pluginConfig.oauthOverrides (desktop loopback flow only).
// WARNING: 37signals Launchpad does NOT support PKCE and treats the client secret as a
// confidential-client credential. A secret shipped in a distributed build is effectively public
// and should be rotated if leaked. Do not claim RFC-8252 non-confidential protection.
declare const process: { env: Record<string, string | undefined> };
const CLIENT_ID = process.env.BASECAMP_CLIENT_ID || 'YOUR_BASECAMP_CLIENT_ID';
const CLIENT_SECRET = process.env.BASECAMP_CLIENT_SECRET || 'YOUR_BASECAMP_CLIENT_SECRET';

interface BasecampAuthorizationAccount {
  id: number;
  name: string;
  product: string;
}

interface BasecampAuthorizationResponse {
  accounts?: BasecampAuthorizationAccount[];
}

interface BasecampDockEntry {
  id?: number;
  title: string;
  name: string;
  url?: string;
  app_url?: string;
}

interface BasecampProject {
  id: number;
  name: string;
  dock?: BasecampDockEntry[];
}

interface BasecampTodolist {
  id: number;
  title: string;
  name?: string;
}

interface BasecampTodo {
  id: number;
  content?: string;
  title?: string;
  description?: string | null;
  completed?: boolean;
  app_url?: string;
  url?: string;
  updated_at?: string;
  created_at?: string;
}

type BasecampTimeTrackingMode = 'off' | 'onStop' | 'onDone' | 'both';

interface BasecampPluginConfig {
  accountId?: string;
  bucketId?: string;
  todolistId?: string;
  timeTracking?: BasecampTimeTrackingMode;
}

type BasecampTimeTrackingTrigger = 'stop' | 'done';

interface CurrentTaskChangePayload {
  current: Task | null;
  previous: Task | null;
}

interface TaskCompletePayload {
  taskId: string;
  task: Task;
}

interface TimeDelta {
  date: string;
  deltaMs: number;
}

// In-memory watermark store. Key: `${issueProviderId}:${todoId}:${date}` → pushed milliseconds.
// Task 3.3 will persist this to plugin-managed synced storage.
const watermarkStore = new Map<string, number>();

let isWatermarksLoaded = false;

const loadWatermarks = async (): Promise<void> => {
  try {
    const dataStr = await PluginAPI.loadSyncedData(WATERMARK_STORAGE_KEY);
    if (dataStr) {
      const data = JSON.parse(dataStr) as Record<string, number>;
      watermarkStore.clear();
      for (const [k, v] of Object.entries(data)) {
        watermarkStore.set(k, v);
      }
    }
  } catch (error) {
    PluginAPI.log?.debug?.('[basecamp-issue-provider] Failed to load watermarks', error);
  }
};

const saveWatermarks = async (): Promise<void> => {
  try {
    const data = Object.fromEntries(watermarkStore.entries());
    await PluginAPI.persistDataSynced(JSON.stringify(data), WATERMARK_STORAGE_KEY);
  } catch (error) {
    PluginAPI.log?.debug?.('[basecamp-issue-provider] Failed to save watermarks', error);
  }
};

const getWatermarkKey = (issueProviderId: string, todoId: string, date: string): string =>
  `${issueProviderId}:${todoId}:${date}`;

const computePositiveDeltas = (
  timeSpentOnDay: Record<string, number> | undefined,
  issueProviderId: string,
  todoId: string,
): TimeDelta[] => {
  if (!timeSpentOnDay) return [];

  const deltas: TimeDelta[] = [];
  for (const [date, trackedMs] of Object.entries(timeSpentOnDay)) {
    const key = getWatermarkKey(issueProviderId, todoId, date);
    const pushedMs = watermarkStore.get(key) ?? 0;
    const deltaMs = trackedMs - pushedMs;
    if (deltaMs > 0) {
      deltas.push({ date, deltaMs });
    }
  }
  return deltas;
};

const t = (key: string): string => {
  try {
    return PluginAPI.translate(key);
  } catch {
    return key;
  }
};

const getAccountScopedUrl = (accountId: string, path: string): string =>
  `${BASECAMP_API_BASE}/${accountId}${path}`;

const formatAccountLabel = (account: BasecampAuthorizationAccount): string =>
  `${account.name} (${account.id})`;

const parseTodosetIdFromUrl = (url?: string): string | null => {
  if (!url) {
    return null;
  }
  const match = url.match(/\/todosets\/(\d+)(?:\.json)?(?:$|[/?#])/);
  return match?.[1] ?? null;
};

const getRequiredConfigValue = (
  config: Record<string, unknown>,
  key: keyof BasecampPluginConfig,
): string => {
  const value = String(config[key] || '').trim();
  if (!value) {
    throw new Error(t(`ERRORS.MISSING_${String(key).toUpperCase()}`));
  }
  return value;
};

const getBasecampTodosUrl = (
  accountId: string,
  bucketId: string,
  todolistId: string,
  page = 1,
): string =>
  `${getAccountScopedUrl(accountId, `/buckets/${bucketId}/todolists/${todolistId}/todos.json`)}?page=${page}`;

const getBasecampTodoLink = (
  accountId: string,
  bucketId: string,
  todoId: string,
): string => `https://3.basecamp.com/${accountId}/buckets/${bucketId}/todos/${todoId}`;

const getBasecampTodoCompletionUrl = (accountId: string, todoId: string): string =>
  getAccountScopedUrl(accountId, `/todos/${todoId}/completion.json`);

const getTodoTitle = (todo: BasecampTodo): string =>
  (todo.content || todo.title || '').trim() || `Todo ${todo.id}`;

const getTodoStatus = (todo: BasecampTodo): string =>
  todo.completed ? 'completed' : 'active';

const isBasecampLinkedTask = (task: Task | null | undefined): task is Task =>
  !!task &&
  task.issueType === BASECAMP_ISSUE_PROVIDER_KEY &&
  typeof task.issueId === 'string' &&
  task.issueId.length > 0;

const isTriggerAllowed = (
  trigger: BasecampTimeTrackingTrigger,
  mode: BasecampTimeTrackingMode | undefined,
): boolean => {
  if (!mode || mode === 'off') return false;
  if (mode === 'both') return true;
  if (mode === 'onStop') return trigger === 'stop';
  if (mode === 'onDone') return trigger === 'done';
  return false;
};

const handleBasecampTimeTrackingTrigger = async (
  trigger: BasecampTimeTrackingTrigger,
  task: Task | null | undefined,
): Promise<void> => {
  if (!isWatermarksLoaded) {
    await loadWatermarks();
    isWatermarksLoaded = true;
  }

  if (!isBasecampLinkedTask(task)) {
    return;
  }

  const config = await PluginAPI.getConfig<BasecampPluginConfig>();
  const mode = config?.timeTracking;

  if (!isTriggerAllowed(trigger, mode)) {
    return;
  }

  const deltas = computePositiveDeltas(
    task.timeSpentOnDay,
    task.issueProviderId ?? '',
    task.issueId ?? '',
  );

  if (deltas.length === 0) {
    return;
  }

  if (!config.accountId) {
    PluginAPI.log?.debug?.('[basecamp-issue-provider] Skipping time push: no accountId');
    return;
  }

  for (const { date, deltaMs } of deltas) {
    const hours = (deltaMs / 3600000).toFixed(2);
    const url = getAccountScopedUrl(
      config.accountId,
      `/recordings/${task.issueId}/timesheet/entries.json`,
    );

    try {
      await postAuthenticatedJson(url, { date, hours });

      // Only update watermark after successful POST (which implies 201 Created from Basecamp)
      const key = getWatermarkKey(task.issueProviderId ?? '', task.issueId ?? '', date);
      const pushedMs = watermarkStore.get(key) ?? 0;
      watermarkStore.set(key, pushedMs + deltaMs);
      await saveWatermarks();

      PluginAPI.log?.debug?.('[basecamp-issue-provider] Time pushed successfully', {
        taskId: task.id,
        issueId: task.issueId,
        date,
        deltaMs,
        hours,
      });
    } catch (error) {
      const reqError = normalizeRequestError(error);
      if (reqError.status === 403 || reqError.status === 404) {
        PluginAPI.showSnack?.({
          msg: t('ERRORS.TIMESHEET_UNAVAILABLE'),
          type: 'ERROR',
          ico: 'error',
        });
        
        PluginAPI.log?.debug?.('[basecamp-issue-provider] Timesheet unavailable (403/404). Leaving watermark unchanged.', {
          taskId: task.id,
          issueId: task.issueId,
          date,
          status: reqError.status,
        });
        continue;
      } else if (reqError.status === 422) {
        PluginAPI.showSnack?.({
          msg: t('ERRORS.TIMESHEET_VALIDATION_FAILED'),
          type: 'ERROR',
          ico: 'error',
        });
        
        PluginAPI.log?.debug?.('[basecamp-issue-provider] Timesheet validation failed, dropping time', {
          taskId: task.id,
          issueId: task.issueId,
          date,
          status: reqError.status,
        });
        
        // Do NOT advance the watermark so the delta is preserved and retried later.
        continue;
      } else if (reqError.status === 429) {
        PluginAPI.showSnack?.({
          msg: t('ERRORS.RATE_LIMITED'),
          type: 'ERROR',
          ico: 'error',
        });
        
        PluginAPI.log?.debug?.('[basecamp-issue-provider] Request rate limited by Basecamp, dropping time for now', {
          taskId: task.id,
          issueId: task.issueId,
          date,
          status: reqError.status,
        });
        
        // Do NOT advance the watermark so the delta is preserved and retried later.
        continue;
      }
      
      // Task 4.x will implement proper failure handling (notifications, etc).
      PluginAPI.log?.debug?.('[basecamp-issue-provider] Time push failed', {
        taskId: task.id,
        issueId: task.issueId,
        date,
        error,
      });
    }
  }
};

PluginAPI.onReady?.(async () => {
  await loadWatermarks();
  isWatermarksLoaded = true;
});

PluginAPI.registerHook(HOOK_PERSISTED_DATA_CHANGED, async () => {
  await loadWatermarks();
  isWatermarksLoaded = true;
});

PluginAPI.registerHook(HOOK_CURRENT_TASK_CHANGE, (payload: unknown) => {
  const { previous } = payload as CurrentTaskChangePayload;
  return handleBasecampTimeTrackingTrigger('stop', previous);
});

PluginAPI.registerHook(HOOK_TASK_COMPLETE, (payload: unknown) => {
  const { task } = payload as TaskCompletePayload;
  return handleBasecampTimeTrackingTrigger('done', task);
});

// Module-level in-memory cache for all-todos fetch with ~30s TTL
interface CacheEntry {
  todos: BasecampTodo[];
  timestamp: number;
}
const TODO_CACHE_TTL_MS = 30000; // 30 seconds
const todolistCache = new Map<string, CacheEntry>();

const getCacheKey = (accountId: string, bucketId: string, todolistId: string): string =>
  `${accountId}:${bucketId}:${todolistId}`;

const mapTodoToSearchResult = (todo: BasecampTodo): PluginSearchResult => ({
  id: String(todo.id),
  title: getTodoTitle(todo),
  url: todo.app_url || todo.url,
  status: getTodoStatus(todo),
  description: todo.description || undefined,
  completed: !!todo.completed,
});

const loadConfiguredTodolistTodos = async (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<BasecampTodo[]> => {
  const accountId = getRequiredConfigValue(config, 'accountId');
  const bucketId = getRequiredConfigValue(config, 'bucketId');
  const todolistId = getRequiredConfigValue(config, 'todolistId');

  const cacheKey = getCacheKey(accountId, bucketId, todolistId);
  const cached = todolistCache.get(cacheKey);
  const now = Date.now();

  // Return cached todos if still within TTL
  if (cached && now - cached.timestamp < TODO_CACHE_TTL_MS) {
    return cached.todos;
  }

  const todos: BasecampTodo[] = [];

  for (let page = 1; page <= BASECAMP_TODOS_PAGE_CAP; page += 1) {
    const pageTodos =
      (await http.get<BasecampTodo[]>(
        getBasecampTodosUrl(accountId, bucketId, todolistId, page),
      )) || [];

    if (!pageTodos.length) {
      break;
    }

    todos.push(...pageTodos);

    if (pageTodos.length < BASECAMP_TODOS_PAGE_SIZE) {
      break;
    }

    if (page === BASECAMP_TODOS_PAGE_CAP) {
      console.warn(
        `[basecamp-issue-provider] Todo import capped at ${BASECAMP_TODOS_PAGE_CAP} pages for todolist ${todolistId}`,
      );
    }
  }

  const filteredTodos = todos.filter((todo) => !todo.completed);

  // Store in cache with current timestamp
  todolistCache.set(cacheKey, { todos: filteredTodos, timestamp: now });

  return filteredTodos;
};

const filterTodosForSearch = (
  todos: BasecampTodo[],
  searchTerm: string,
): BasecampTodo[] => {
  const needle = searchTerm.trim().toLowerCase();
  if (!needle) {
    return todos;
  }
  return todos.filter((todo) => {
    const haystacks = [todo.content, todo.title, todo.description, todo.app_url, todo.url]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((value) => value.toLowerCase());
    return haystacks.some((value) => value.includes(needle));
  });
};

const loadBasecampAccounts = async (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const data = await http.get<BasecampAuthorizationResponse>(BASECAMP_AUTHORIZATION_URL);
  const accounts = (data?.accounts || [])
    .filter((account) => account.product === 'bc3')
    .map((account) => ({
      label: formatAccountLabel(account),
      value: String(account.id),
    }));

  if (accounts.length === 1 && !config['accountId']) {
    config['accountId'] = accounts[0].value;
  }

  return accounts;
};

const loadBasecampProjects = async (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const accountId = String(config['accountId'] || '').trim();
  if (!accountId) {
    return [];
  }
  const projects = await http.get<BasecampProject[]>(
    getAccountScopedUrl(accountId, '/projects.json'),
  );
  return (projects || []).map((project) => ({
    label: project.name,
    value: String(project.id),
  }));
};

const loadBasecampTodolists = async (
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<{ label: string; value: string }[]> => {
  const accountId = String(config['accountId'] || '').trim();
  const bucketId = String(config['bucketId'] || '').trim();
  if (!accountId || !bucketId) {
    return [];
  }

  const project = await http.get<BasecampProject>(
    getAccountScopedUrl(accountId, `/projects/${bucketId}.json`),
  );
  const todoset = (project?.dock || []).find((entry) => entry.name === 'todoset');
  if (!todoset) {
    return [];
  }
  const todosetId =
    String(todoset.id || '').trim() ||
    parseTodosetIdFromUrl(todoset.url) ||
    parseTodosetIdFromUrl(todoset.app_url);
  if (!todosetId) {
    return [];
  }

  const todolists = await http.get<BasecampTodolist[]>(
    getAccountScopedUrl(accountId, `/todosets/${todosetId}/todolists.json`),
  );
  return (todolists || []).map((todolist) => ({
    label: todolist.title || todolist.name || String(todolist.id),
    value: String(todolist.id),
  }));
};

const getAuthenticatedJsonHeaders = async (): Promise<Record<string, string>> => {
  const token = await PluginAPI.getOAuthToken();
  if (!token) {
    throw new Error(t('ERRORS.NOT_AUTHENTICATED'));
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
};

const normalizeRequestError = (error: unknown): Error & {
  status?: number;
  responseBody?: string;
} => {
  const normalized = (
    error instanceof Error ? error : new Error('Host request failed')
  ) as Error & {
    status?: number;
    responseBody?: string;
  };
  const status =
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined;
  const responseBodySource =
    typeof error === 'object' && error !== null && 'error' in error
      ? (error as { error?: unknown }).error
      : undefined;
  const responseBody =
    typeof responseBodySource === 'string'
      ? responseBodySource
      : responseBodySource == null
        ? undefined
        : JSON.stringify(responseBodySource);

  if (status !== undefined) {
    normalized.message = `HTTP ${status}`;
    normalized.status = status;
  }

  if (responseBody?.trim()) {
    normalized.responseBody = responseBody;
  }

  return normalized;
};

const postAuthenticatedJson = async <TResponse = unknown>(
  url: string,
  body: unknown,
): Promise<TResponse | undefined> => {
  try {
    const response = await PluginAPI.request<TResponse | null>(url, {
      method: 'POST',
      headers: {
        ...(await getAuthenticatedJsonHeaders()),
        'Content-Type': 'application/json',
      },
      body,
    });

    return response ?? undefined;
  } catch (error) {
    throw normalizeRequestError(error);
  }
};

PluginAPI.registerIssueProvider({
  configFields: [
    {
      key: 'oauth',
      type: 'oauthButton' as const,
      label: t('CFG.CONNECT'),
      description: t('CFG.OAUTH_NOTE'),
      oauthConfig: {
        authUrl: BASECAMP_AUTH_URL,
        tokenUrl: BASECAMP_TOKEN_URL,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: BASECAMP_REDIRECT_URI,
        scopes: [BASECAMP_SCOPE],
        extraAuthParams: {
          type: 'web_server',
        },
      },
    },
    {
      key: 'oauthOverrides.clientId',
      type: 'input' as const,
      label: t('CFG.CLIENT_ID'),
      description: t('CFG.CLIENT_ID_DESC'),
      required: false,
      advanced: true,
    },
    {
      key: 'oauthOverrides.clientSecret',
      type: 'password' as const,
      label: t('CFG.CLIENT_SECRET'),
      description: t('CFG.CLIENT_SECRET_DESC'),
      required: false,
      advanced: true,
    },
    {
      key: 'oauthOverrides.redirectUri',
      type: 'input' as const,
      label: t('CFG.REDIRECT_URI'),
      description: t('CFG.REDIRECT_URI_DESC'),
      required: false,
      advanced: true,
    },
    {
      key: 'accountId',
      type: 'select' as const,
      label: t('CFG.ACCOUNT'),
      required: true,
      options: [],
      loadOptions: loadBasecampAccounts,
    },
    {
      key: 'bucketId',
      type: 'select' as const,
      label: t('CFG.PROJECT'),
      required: true,
      options: [],
      showIf: 'accountId',
      loadOptions: loadBasecampProjects,
    },
    {
      key: 'todolistId',
      type: 'select' as const,
      label: t('CFG.TODOLIST'),
      required: true,
      options: [],
      showIf: 'bucketId',
      loadOptions: loadBasecampTodolists,
    },
    {
      key: 'timeTracking',
      type: 'select' as const,
      label: t('CFG.TIME_TRACKING'),
      description: t('CFG.TIME_TRACKING_DESC'),
      required: false,
      advanced: true,
      options: [
        { label: t('CFG.TIME_TRACKING_BOTH'), value: 'both' },
        { label: t('CFG.TIME_TRACKING_ON_STOP'), value: 'onStop' },
        { label: t('CFG.TIME_TRACKING_ON_DONE'), value: 'onDone' },
        { label: t('CFG.TIME_TRACKING_OFF'), value: 'off' },
      ],
    },
  ],

  async getHeaders(_config: Record<string, unknown>): Promise<Record<string, string>> {
    return getAuthenticatedJsonHeaders();
  },

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const todos = await loadConfiguredTodolistTodos(config, http);
    return filterTodosForSearch(todos, searchTerm).map(mapTodoToSearchResult);
  },

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const todos = await loadConfiguredTodolistTodos(config, http);
    return todos.map(mapTodoToSearchResult);
  },

  async getById(issueId: string, config: Record<string, unknown>, http: PluginHttp) {
    const accountId = getRequiredConfigValue(config, 'accountId');
    const bucketId = getRequiredConfigValue(config, 'bucketId');
    const todo = await http.get<BasecampTodo>(
      getAccountScopedUrl(accountId, `/todos/${issueId}.json`),
    );

    const lastUpdatedSource = todo.updated_at || todo.created_at;
    return {
      id: String(todo.id),
      title: getTodoTitle(todo),
      body: todo.description || '',
      url:
        todo.app_url ||
        todo.url ||
        getBasecampTodoLink(accountId, bucketId, String(todo.id)),
      state: getTodoStatus(todo),
      completed: !!todo.completed,
      lastUpdated: lastUpdatedSource ? new Date(lastUpdatedSource).getTime() : undefined,
    };
  },

  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    const accountId = getRequiredConfigValue(config, 'accountId');
    const bucketId = getRequiredConfigValue(config, 'bucketId');
    return getBasecampTodoLink(accountId, bucketId, issueId);
  },

  issueDisplay: [
    { field: 'title', label: t('DISPLAY.TITLE'), type: 'link', linkField: 'url' },
    { field: 'state', label: t('DISPLAY.STATUS'), type: 'text' },
    { field: 'body', label: t('DISPLAY.DESCRIPTION'), type: 'markdown', hideEmpty: true },
  ],

  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'completed',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown): boolean => !!taskValue,
      toTaskValue: (issueValue: unknown): boolean => !!issueValue,
    },
  ] satisfies PluginFieldMapping[],

  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    if (!Object.prototype.hasOwnProperty.call(changes, 'completed')) {
      return;
    }

    const accountId = getRequiredConfigValue(config, 'accountId');
    const isCompleted = !!changes['completed'];
    const completionUrl = getBasecampTodoCompletionUrl(accountId, id);

    if (isCompleted) {
      await http.post(completionUrl, {});
      return;
    }

    await http.delete(completionUrl);
  },
});

// Test-only exports for cache management during testing
declare const __TEST__: boolean;
export const __clearTodolistCacheForTests = (): void => {
  if (typeof __TEST__ !== 'undefined' && __TEST__) {
    todolistCache.clear();
  }
};

export const __postAuthenticatedJsonForTests = async <TResponse = unknown>(
  url: string,
  body: unknown,
): Promise<TResponse | undefined> => {
  if (typeof __TEST__ !== 'undefined' && __TEST__) {
    return postAuthenticatedJson<TResponse>(url, body);
  }
  throw new Error('Test helper unavailable outside test mode');
};

export const __watermarkStoreForTests = {
  get: (key: string): number | undefined => {
    if (typeof __TEST__ !== 'undefined' && __TEST__) {
      return watermarkStore.get(key);
    }
    throw new Error('Test helper unavailable outside test mode');
  },
  set: (key: string, value: number): void => {
    if (typeof __TEST__ !== 'undefined' && __TEST__) {
      watermarkStore.set(key, value);
      return;
    }
    throw new Error('Test helper unavailable outside test mode');
  },
  clear: (): void => {
    if (typeof __TEST__ !== 'undefined' && __TEST__) {
      watermarkStore.clear();
      return;
    }
    throw new Error('Test helper unavailable outside test mode');
  },
  getKey: (issueProviderId: string, todoId: string, date: string): string => {
    if (typeof __TEST__ !== 'undefined' && __TEST__) {
      return getWatermarkKey(issueProviderId, todoId, date);
    }
    throw new Error('Test helper unavailable outside test mode');
  },
};

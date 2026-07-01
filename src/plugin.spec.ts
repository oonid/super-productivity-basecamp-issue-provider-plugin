import { beforeAll, beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import type { IssueProviderPluginDefinition } from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;
let getOAuthTokenMock: ReturnType<typeof vi.fn>;
let clearTodolistCacheForTests: () => void;

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
  (globalThis as any).PluginAPI = {
    registerIssueProvider: vi.fn((def: IssueProviderPluginDefinition) => {
      definition = def;
    }),
    translate: vi.fn((key: string) => key),
    startOAuthFlow: vi.fn(),
    getOAuthToken: getOAuthTokenMock,
  };
  (globalThis as any).__TEST__ = true;
  const pluginModule = await import('./plugin');
  clearTodolistCacheForTests = pluginModule.__clearTodolistCacheForTests;
});

describe('Basecamp Issue Provider Plugin', () => {
  beforeEach(() => {
    getOAuthTokenMock.mockReset();
    getOAuthTokenMock.mockResolvedValue('mock-token');
    clearTodolistCacheForTests();
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
      await expect(definition.getHeaders({})).rejects.toThrow('ERRORS.NOT_AUTHENTICATED');
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
      ).rejects.toThrow('ERRORS.MISSING_ACCOUNTID');

      // Missing bucketId
      await expect(
        definition.searchIssues(
          'test',
          { accountId: '1234567', todolistId: '77' },
          http as any,
        ),
      ).rejects.toThrow('ERRORS.MISSING_BUCKETID');

      // Missing todolistId
      await expect(
        definition.searchIssues(
          'test',
          { accountId: '1234567', bucketId: '42' },
          http as any,
        ),
      ).rejects.toThrow('ERRORS.MISSING_TODOLISTID');
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

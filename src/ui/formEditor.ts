import * as vscode from 'vscode';
import type {
  AssistantId,
  Scope,
  ItemKind,
  ManagedInstallation,
} from '../domain/types';
import type {
  CanonicalSkill,
  CanonicalAgent,
  CanonicalCommand,
  CanonicalMcpServer,
} from '../adapters/types';
import {
  canonicalSkillHash,
  canonicalAgentHash,
  canonicalCommandHash,
  canonicalMcpServerHash,
} from '../adapters/codec';
import { readState, writeState } from '../domain/registry';
import { getAdapter } from '../adapters/registry';

export interface FormEditorContext {
  mode: 'create' | 'edit';
  assistant: AssistantId;
  scope: Scope;
  projectRoot?: string;
  kind: ItemKind;
  name?: string;
  sourceInstallation?: ManagedInstallation;
}

export class FormEditorPanel {
  public static currentPanel: FormEditorPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: FormEditorContext;
  private _disposables: vscode.Disposable[] = [];
  private _onSavedCallback?: () => void;

  private constructor(
    panel: vscode.WebviewPanel,
    context: FormEditorContext,
    onSaved?: () => void
  ) {
    this._panel = panel;
    this._context = context;
    this._onSavedCallback = onSaved;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'save':
            await this.handleSave(message.data);
            break;
          case 'cancel':
            this.dispose();
            break;
        }
      },
      null,
      this._disposables
    );

    this.renderHtml();
  }

  public static async open(
    context: FormEditorContext,
    onSaved?: () => void
  ): Promise<FormEditorPanel> {
    const title =
      context.mode === 'create'
        ? `Create ${context.kind}`
        : `Edit ${context.kind}: ${context.name}`;

    if (FormEditorPanel.currentPanel) {
      FormEditorPanel.currentPanel._panel.title = title;
      FormEditorPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      return FormEditorPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiSwissknifeFormEditor',
      title,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    FormEditorPanel.currentPanel = new FormEditorPanel(panel, context, onSaved);
    return FormEditorPanel.currentPanel;
  }

  public dispose() {
    FormEditorPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private async handleSave(data: Record<string, unknown>): Promise<void> {
    const adapter = getAdapter(this._context.assistant);
    const loc = {
      scope: this._context.scope,
      projectRoot: this._context.projectRoot,
    };

    const name = String(data.name || data.id || '').trim();
    if (!name) {
      vscode.window.showErrorMessage('Name / ID is required.');
      return;
    }

    let contentHash: string;
    let targetPath: string;

    try {
      if (this._context.kind === 'skill') {
        const skill: CanonicalSkill = {
          name,
          description: String(data.description || '').trim(),
          body: String(data.body || ''),
          extraFields: (data.extraFields as Record<string, unknown>) || {},
          files: [],
        };
        await adapter.writeSkill(skill, loc);
        contentHash = canonicalSkillHash(skill);
        targetPath = adapter.skillDir(name, loc);
      } else if (this._context.kind === 'agent') {
        const agent: CanonicalAgent = {
          name,
          description: String(data.description || '').trim(),
          mode: (data.mode as 'primary' | 'subagent' | 'all') || 'primary',
          tools: Array.isArray(data.tools) ? data.tools.map(String) : [],
          permissions: (data.permissions as Record<string, 'allow' | 'deny' | 'ask'>) || {},
          model: data.model ? String(data.model) : undefined,
          variant: data.variant ? String(data.variant) : undefined,
          body: String(data.body || ''),
          extraFields: (data.extraFields as Record<string, unknown>) || {},
        };
        await adapter.writeAgent(agent, loc);
        contentHash = canonicalAgentHash(agent);
        targetPath = adapter.agentPath(name, loc);
      } else if (this._context.kind === 'command') {
        const cmd: CanonicalCommand = {
          name,
          description: String(data.description || '').trim(),
          agent: data.agent ? String(data.agent) : undefined,
          model: data.model ? String(data.model) : undefined,
          subtask: Boolean(data.subtask),
          body: String(data.body || ''),
          extraFields: (data.extraFields as Record<string, unknown>) || {},
        };
        await adapter.writeCommand(cmd, loc);
        contentHash = canonicalCommandHash(cmd);
        targetPath = adapter.commandPath(name, loc);
      } else if (this._context.kind === 'mcp-server') {
        let envObj: Record<string, string> | undefined;
        if (typeof data.env === 'string' && data.env.trim()) {
          try {
            envObj = JSON.parse(data.env);
          } catch {
            // ignore
          }
        } else if (typeof data.env === 'object' && data.env) {
          envObj = data.env as Record<string, string>;
        }

        const mcp: CanonicalMcpServer = {
          id: name,
          type: (data.type as 'stdio' | 'http' | 'sse') || 'stdio',
          command: data.command ? String(data.command) : undefined,
          args: Array.isArray(data.args)
            ? data.args.map(String)
            : typeof data.args === 'string' && data.args.trim()
            ? data.args.split('\n').map((s) => s.trim()).filter(Boolean)
            : undefined,
          url: data.url ? String(data.url) : undefined,
          env: envObj,
          extraFields: (data.extraFields as Record<string, unknown>) || {},
        };
        await adapter.writeMcpServer(mcp, loc);
        contentHash = canonicalMcpServerHash(mcp);
        targetPath = adapter.mcpConfigPath(loc);
      } else {
        throw new Error(`Unsupported kind for form editor: ${this._context.kind}`);
      }

      // Update state.json if managed
      const state = await readState(this._context.scope, this._context.projectRoot);
      const existingIdx = state.installations.findIndex(
        (i) =>
          i.assistant === this._context.assistant &&
          i.scope === this._context.scope &&
          i.projectPath === this._context.projectRoot &&
          i.kind === this._context.kind &&
          i.name === name
      );

      const installation: ManagedInstallation = {
        assistant: this._context.assistant,
        scope: this._context.scope,
        projectPath: this._context.projectRoot,
        kind: this._context.kind,
        name,
        path: targetPath,
        sourceId: this._context.sourceInstallation?.sourceId ?? 'form-editor',
        installedAt: new Date().toISOString(),
        contentHash,
      };

      if (existingIdx !== -1) {
        state.installations[existingIdx] = installation;
      } else {
        state.installations.push(installation);
      }

      await writeState(
        this._context.scope,
        state,
        this._context.projectRoot
      );

      vscode.window.showInformationMessage(`Saved ${this._context.kind} "${name}".`);
      this._onSavedCallback?.();
      this.dispose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to save ${this._context.kind}: ${msg}`);
    }
  }

  private async renderHtml(): Promise<void> {
    const adapter = getAdapter(this._context.assistant);
    const loc = {
      scope: this._context.scope,
      projectRoot: this._context.projectRoot,
    };

    let existingData: Record<string, unknown> = {
      name: this._context.name || '',
      description: '',
      body: '',
      extraFields: {},
    };

    if (this._context.mode === 'edit' && this._context.name) {
      if (this._context.kind === 'skill') {
        const s = await adapter.readSkill(this._context.name, loc);
        if (s) {
          existingData = {
            name: s.name,
            description: s.description,
            body: s.body,
            extraFields: s.extraFields,
          };
        }
      } else if (this._context.kind === 'agent') {
        const a = await adapter.readAgent(this._context.name, loc);
        if (a) {
          existingData = {
            name: a.name,
            description: a.description,
            mode: a.mode ?? 'primary',
            tools: a.tools,
            permissions: a.permissions,
            model: a.model ?? '',
            variant: a.variant ?? '',
            body: a.body,
            extraFields: a.extraFields,
          };
        }
      } else if (this._context.kind === 'command') {
        const c = await adapter.readCommand(this._context.name, loc);
        if (c) {
          existingData = {
            name: c.name,
            description: c.description,
            agent: c.agent ?? '',
            model: c.model ?? '',
            subtask: c.subtask ?? false,
            body: c.body,
            extraFields: c.extraFields,
          };
        }
      } else if (this._context.kind === 'mcp-server') {
        const m = await adapter.readMcpServer(this._context.name, loc);
        if (m) {
          existingData = {
            name: m.id,
            type: m.type,
            command: m.command ?? '',
            args: m.args ? m.args.join('\n') : '',
            url: m.url ?? '',
            env: m.env ? JSON.stringify(m.env, null, 2) : '',
            extraFields: m.extraFields,
          };
        }
      }
    }

    this._panel.webview.html = this.getHtml(existingData);
  }

  public getHtml(data: Record<string, unknown>): string {
    const isCreate = this._context.mode === 'create';
    const kind = this._context.kind;
    const extraFieldsJson =
      data.extraFields && Object.keys(data.extraFields as object).length > 0
        ? JSON.stringify(data.extraFields, null, 2)
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isCreate ? 'Create' : 'Edit'} ${kind}</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --card-bg: var(--vscode-sideBar-background, #252526);
      --border: var(--vscode-panel-border, #333);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #fff);
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #fff);
      --input-border: var(--vscode-input-border, #555);
    }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      background-color: var(--bg);
      color: var(--fg);
      padding: 20px 24px;
      margin: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .title-group h1 {
      margin: 0 0 4px 0;
      font-size: 20px;
      font-weight: 600;
    }
    .meta-badges {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      background: rgba(255, 255, 255, 0.1);
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .btn {
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      border-radius: 4px;
      padding: 6px 14px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    }
    .btn-secondary {
      background: rgba(255, 255, 255, 0.1);
      color: var(--fg);
      border: 1px solid var(--border);
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      margin-bottom: 4px;
      font-size: 12px;
      font-weight: 600;
      opacity: 0.9;
    }
    .hint {
      font-size: 11px;
      opacity: 0.6;
      margin-top: 2px;
    }
    input[type="text"], select, textarea {
      width: 100%;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 8px 10px;
      font-size: 13px;
      font-family: inherit;
      box-sizing: border-box;
    }
    textarea {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      resize: vertical;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .checkbox-group {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 4px;
    }
    .checkbox-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h1>${isCreate ? 'Create' : 'Edit'} ${kind}</h1>
      <div class="meta-badges">
        <span class="badge">${this._context.assistant}</span>
        <span class="badge">${this._context.scope}</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="cancel()">Cancel</button>
      <button class="btn" onclick="save()">Save</button>
    </div>
  </div>

  <form id="editorForm">
    <div class="grid-2">
      <div class="form-group">
        <label for="name">Name / Identifier *</label>
        <input type="text" id="name" value="${data.name || ''}" ${!isCreate ? 'readonly' : ''} placeholder="e.g. gitignore, code-reviewer">
      </div>
      <div class="form-group">
        <label for="description">Description</label>
        <textarea id="description" rows="3" placeholder="Short summary of what this component does">${data.description || ''}</textarea>
      </div>
    </div>

    ${
      kind === 'agent'
        ? `
      <div class="grid-2">
        <div class="form-group">
          <label for="agentMode">Agent Mode</label>
          <select id="agentMode">
            <option value="primary" ${data.mode === 'primary' ? 'selected' : ''}>Primary (Direct Chat)</option>
            <option value="subagent" ${data.mode === 'subagent' ? 'selected' : ''}>Subagent (Delegation)</option>
            <option value="all" ${data.mode === 'all' ? 'selected' : ''}>All</option>
          </select>
        </div>
        <div class="form-group">
          <label for="agentModel">Model Override (Optional)</label>
          <input type="text" id="agentModel" value="${data.model || ''}" placeholder="e.g. claude-3-5-sonnet, gemini-3.7-flash">
        </div>
      </div>

      <div class="form-group">
        <label>Allowed Tools / Capabilities</label>
        <div class="checkbox-group">
          <label class="checkbox-item"><input type="checkbox" name="tool" value="read" ${(data.tools as string[] || []).includes('read') || (data.permissions as Record<string, string> || {}).read === 'allow' ? 'checked' : ''}> read</label>
          <label class="checkbox-item"><input type="checkbox" name="tool" value="edit" ${(data.tools as string[] || []).includes('edit') || (data.permissions as Record<string, string> || {}).edit === 'allow' ? 'checked' : ''}> edit</label>
          <label class="checkbox-item"><input type="checkbox" name="tool" value="bash" ${(data.tools as string[] || []).includes('bash') || (data.permissions as Record<string, string> || {}).bash === 'allow' ? 'checked' : ''}> bash</label>
          <label class="checkbox-item"><input type="checkbox" name="tool" value="skill" ${(data.tools as string[] || []).includes('skill') || (data.permissions as Record<string, string> || {}).skill === 'allow' ? 'checked' : ''}> skill</label>
          <label class="checkbox-item"><input type="checkbox" name="tool" value="webfetch" ${(data.tools as string[] || []).includes('webfetch') || (data.permissions as Record<string, string> || {}).webfetch === 'allow' ? 'checked' : ''}> webfetch</label>
          <label class="checkbox-item"><input type="checkbox" name="tool" value="mcp" ${(data.tools as string[] || []).includes('mcp') || (data.permissions as Record<string, string> || {}).mcp === 'allow' ? 'checked' : ''}> mcp</label>
        </div>
      </div>
    `
        : ''
    }

    ${
      kind === 'command'
        ? `
      <div class="grid-2">
        <div class="form-group">
          <label for="cmdAgent">Associated Agent (Optional)</label>
          <input type="text" id="cmdAgent" value="${data.agent || ''}" placeholder="e.g. general, explore">
        </div>
        <div class="form-group">
          <label for="cmdModel">Model Override (Optional)</label>
          <input type="text" id="cmdModel" value="${data.model || ''}" placeholder="e.g. claude-3-5-sonnet">
        </div>
      </div>
      <div class="form-group">
        <label class="checkbox-item"><input type="checkbox" id="cmdSubtask" ${data.subtask ? 'checked' : ''}> Run as subtask</label>
      </div>
    `
        : ''
    }

    ${
      kind === 'mcp-server'
        ? `
      <div class="grid-2">
        <div class="form-group">
          <label for="mcpType">Protocol Type</label>
          <select id="mcpType">
            <option value="stdio" ${data.type === 'stdio' ? 'selected' : ''}>stdio (Local CLI Process)</option>
            <option value="sse" ${data.type === 'sse' ? 'selected' : ''}>sse / http (Remote Server)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="mcpCommand">Command / URL</label>
          <input type="text" id="mcpCommand" value="${data.command || data.url || ''}" placeholder="e.g. npx, uvx, https://example.com/sse">
        </div>
      </div>
      <div class="form-group">
        <label for="mcpArgs">Arguments (One per line)</label>
        <textarea id="mcpArgs" rows="3" placeholder="-y\n@modelcontextprotocol/server-github">${data.args || ''}</textarea>
      </div>
      <div class="form-group">
        <label for="mcpEnv">Environment Variables (JSON object)</label>
        <textarea id="mcpEnv" rows="3" placeholder='{"API_KEY": "value"}'>${data.env || ''}</textarea>
      </div>
    `
        : ''
    }

    ${
      kind !== 'mcp-server'
        ? `
      <div class="form-group">
        <label for="body">Prompt / Instructions / Template (Markdown)</label>
        <textarea id="body" rows="14" placeholder="Enter markdown instructions, prompt template, or guidelines...">${data.body || ''}</textarea>
      </div>
    `
        : ''
    }

    ${
      extraFieldsJson
        ? `
      <div class="form-group">
        <label>Preserved Extra Fields (Read-Only)</label>
        <textarea rows="4" readonly style="opacity:0.7;">${extraFieldsJson}</textarea>
      </div>
    `
        : ''
    }
  </form>

  <script>
    const vscode = acquireVsCodeApi();
    const rawExtraFields = ${JSON.stringify(data.extraFields || {})};

    function cancel() {
      vscode.postMessage({ command: 'cancel' });
    }

    function save() {
      const name = document.getElementById('name').value.trim();
      const description = document.getElementById('description') ? document.getElementById('description').value.trim() : '';
      const body = document.getElementById('body') ? document.getElementById('body').value : '';

      const payload = {
        name,
        description,
        body,
        extraFields: rawExtraFields,
      };

      const kind = '${kind}';

      if (kind === 'agent') {
        payload.mode = document.getElementById('agentMode').value;
        payload.model = document.getElementById('agentModel').value.trim();
        const selectedTools = [];
        const permissions = {};
        document.querySelectorAll('input[name="tool"]:checked').forEach(cb => {
          selectedTools.push(cb.value);
          permissions[cb.value] = 'allow';
        });
        payload.tools = selectedTools;
        payload.permissions = permissions;
      }

      if (kind === 'command') {
        payload.agent = document.getElementById('cmdAgent').value.trim();
        payload.model = document.getElementById('cmdModel').value.trim();
        payload.subtask = document.getElementById('cmdSubtask').checked;
      }

      if (kind === 'mcp-server') {
        payload.type = document.getElementById('mcpType').value;
        const cmdOrUrl = document.getElementById('mcpCommand').value.trim();
        if (payload.type === 'stdio') {
          payload.command = cmdOrUrl;
        } else {
          payload.url = cmdOrUrl;
        }
        payload.args = document.getElementById('mcpArgs').value;
        payload.env = document.getElementById('mcpEnv').value;
      }

      vscode.postMessage({ command: 'save', data: payload });
    }
  </script>
</body>
</html>`;
  }
}

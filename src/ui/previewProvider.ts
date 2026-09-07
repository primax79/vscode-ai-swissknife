import * as vscode from 'vscode';
import type { PreparedInstall } from '../engine/types';
import {
  serializeSkillMarkdown,
  serializeClaudeAgentMarkdown,
  serializeClaudeCommandMarkdown,
} from '../adapters/claude';
import {
  serializeKiloAgentMarkdown,
  serializeKiloCommandMarkdown,
} from '../adapters/kilo';

export class PreviewProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'ai-swissknife-preview';
  private contentMap = new Map<string, string>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentMap.get(uri.path) || 'No preview content found.';
  }

  public setPreviewContent(id: string, prepared: PreparedInstall): vscode.Uri {
    if (!prepared.supported) {
      this.contentMap.set(id, 'Installation not supported.');
      return vscode.Uri.parse(`${PreviewProvider.scheme}:${id}.md`);
    }

    let contentStr = '';
    const assistant = prepared.plan.targetAssistant;

    switch (prepared.kind) {
      case 'skill':
        contentStr = serializeSkillMarkdown(prepared.content);
        break;
      case 'agent':
        contentStr =
          assistant === 'kilo-code'
            ? serializeKiloAgentMarkdown(prepared.content)
            : serializeClaudeAgentMarkdown(prepared.content);
        break;
      case 'command':
        contentStr =
          assistant === 'kilo-code'
            ? serializeKiloCommandMarkdown(prepared.content)
            : serializeClaudeCommandMarkdown(prepared.content);
        break;
      case 'mcp-server':
        contentStr = JSON.stringify(prepared.content, null, 2);
        break;
      case 'hook':
        contentStr = `// Hook: ${prepared.content.name}\nEvent: ${prepared.content.event}\nCommand: ${prepared.content.command}`;
        break;
      case 'rule':
        contentStr = prepared.content.content;
        break;
      default:
        contentStr = 'Unknown kind.';
    }

    this.contentMap.set(id, contentStr);
    
    let ext = '.md';
    if (prepared.kind === 'mcp-server') ext = '.json';
    if (prepared.kind === 'hook') ext = '.ts';
    
    return vscode.Uri.parse(`${PreviewProvider.scheme}:${id}${ext}`);
  }
}

export const previewProvider = new PreviewProvider();

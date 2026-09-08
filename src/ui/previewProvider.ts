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
    return this.contentMap.get(uri.toString()) || 'No preview content found.';
  }

  public setDiffContent(id: string, contentStr: string, ext: string = '.md'): vscode.Uri {
    const uri = vscode.Uri.parse(`${PreviewProvider.scheme}:${id}${ext}`);
    this.contentMap.set(uri.toString(), contentStr);
    return uri;
  }

  public setPreviewContent(id: string, prepared: PreparedInstall): vscode.Uri {
    if (!prepared.supported) {
      const uri = vscode.Uri.parse(`${PreviewProvider.scheme}:${id}.md`);
      this.contentMap.set(uri.toString(), 'Installation not supported.');
      return uri;
    }

    let ext = '.md';
    if (prepared.kind === 'mcp-server') ext = '.json';
    if (prepared.kind === 'hook') ext = '.ts';
    
    const uri = vscode.Uri.parse(`${PreviewProvider.scheme}:${id}${ext}`);

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

    this.contentMap.set(uri.toString(), contentStr);
    return uri;
  }
}

export const previewProvider = new PreviewProvider();

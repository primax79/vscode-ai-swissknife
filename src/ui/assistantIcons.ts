import * as vscode from 'vscode';
import type { AssistantId } from '../domain/types';

export function getAssistantIconPath(
  assistant: AssistantId,
  extensionUri: vscode.Uri
): { light: vscode.Uri; dark: vscode.Uri } {
  switch (assistant) {
    case 'claude-code': {
      const uri = vscode.Uri.joinPath(extensionUri, 'resources', 'claude.svg');
      return { light: uri, dark: uri };
    }
    case 'kilo-code':
      return {
        light: vscode.Uri.joinPath(extensionUri, 'resources', 'kilocode-light.svg'),
        dark: vscode.Uri.joinPath(extensionUri, 'resources', 'kilocode-dark.svg'),
      };
    case 'github-copilot':
      return {
        light: vscode.Uri.joinPath(extensionUri, 'resources', 'githubcopilot-light.svg'),
        dark: vscode.Uri.joinPath(extensionUri, 'resources', 'githubcopilot-dark.svg'),
      };
    case 'codex-cli': {
      const uri = vscode.Uri.joinPath(extensionUri, 'resources', 'openai.svg');
      return { light: uri, dark: uri };
    }
    case 'gemini-cli': {
      const uri = vscode.Uri.joinPath(extensionUri, 'resources', 'gemini.svg');
      return { light: uri, dark: uri };
    }
  }
}

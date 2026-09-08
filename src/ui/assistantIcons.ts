import * as vscode from 'vscode';
import type { AssistantId } from '../domain/types';

/**
 * `$(...)` codicon reference for the custom icon font contributed in
 * package.json's `contributes.icons` — usable inline in a TreeItem's
 * label/description, unlike `getAssistantIconPath`'s Uri (which only fits
 * the single `iconPath` slot). Monochrome, tinted by the active theme,
 * same as any other codicon.
 */
export function getAssistantInlineIcon(assistant: AssistantId): string {
  switch (assistant) {
    case 'claude-code':
      return '$(ai-swissknife-claude-code)';
    case 'kilo-code':
      return '$(ai-swissknife-kilo-code)';
    case 'github-copilot':
      return '$(ai-swissknife-github-copilot)';
    case 'codex-cli':
      return '$(ai-swissknife-codex-cli)';
    case 'gemini-cli':
      return '$(ai-swissknife-gemini-cli)';
  }
}

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

import * as path from 'path';
import type { Scope, SourceType } from '../domain/types';

function isUrl(v: string): boolean {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v)) {
    return true;
  }
  if (/^([^\s/@:]+)@([^\s/:]+):(.+)$/.test(v)) {
    return true;
  }
  return false;
}

function isValidGitLocation(v: string): boolean {
  if (v.startsWith('https://') || v.startsWith('ssh://')) {
    try {
      const url = new URL(v);
      const repoPath = url.pathname.replace(/^\/+|\/+$/g, '');
      return (
        (url.protocol === 'https:' || url.protocol === 'ssh:') &&
        Boolean(url.host) &&
        repoPath.length > 0
      );
    } catch {
      return false;
    }
  }

  const scpMatch = v.match(/^([^\s/@:]+)@([^\s/:]+):(.+)$/);
  if (scpMatch) {
    const repoPath = scpMatch[3].replace(/^\/+|\/+$/g, '');
    return repoPath.length > 0;
  }

  return false;
}

function isValidRemoteUrl(v: string): boolean {
  if (!v.startsWith('http://') && !v.startsWith('https://')) {
    return false;
  }
  try {
    const url = new URL(v);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.host)
    );
  } catch {
    return false;
  }
}

export function validateLocation(type: SourceType, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'Location cannot be empty';
  }

  switch (type) {
    case 'git-custom':
    case 'git-marketplace':
    case 'git-single-item':
      return isValidGitLocation(trimmed)
        ? null
        : 'Git repository URL must use HTTPS (https://...) or SSH (git@... or ssh://...)';
    case 'remote-url':
      return isValidRemoteUrl(trimmed)
        ? null
        : 'Remote URL must be a valid HTTP or HTTPS URL (http://... or https://...)';
    case 'local-folder':
      return isUrl(trimmed)
        ? 'Local folder path cannot be a URL'
        : null;
    default: {
      const _exhaustive: never = type;
      return `Unsupported source type: ${_exhaustive}`;
    }
  }
}

export function validateLocalFolder(
  value: string,
  scope: Scope,
  rootDir: string
): string | null {
  const basic = validateLocation('local-folder', value);
  if (basic) {
    return basic;
  }

  const trimmed = value.trim();
  const absRoot = path.resolve(rootDir);
  const absLocal = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(absRoot, trimmed);
  const rel = path.relative(absRoot, absLocal);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const scopeLabel = scope === 'project' ? 'workspace' : 'home';
    return `Path "${trimmed}" lies outside ${scopeLabel} root "${rootDir}"`;
  }
  return null;
}

function extractRawSegment(location: string): string {
  const trimmed = location.trim();
  if (!trimmed) {
    return '';
  }

  const scpMatch = trimmed.match(/^([^\s/@:]+)@([^\s/:]+):(.+)$/);
  if (scpMatch) {
    const scpPath = scpMatch[3].replace(/[/\\]+$/, '');
    const segments = scpPath.split(/[/\\]/).filter(Boolean);
    return segments[segments.length - 1] ?? '';
  }

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/[/\\]+$/, '');
    const segments = pathname.split(/[/\\]/).filter(Boolean);
    return segments[segments.length - 1] ?? '';
  } catch {
    // Fall back to filesystem path splitting
  }

  const clean = trimmed.replace(/[/\\]+$/, '');
  const segments = clean.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

function slugify(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep original string if percent-decoding fails
  }

  return decoded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function humanize(id: string): string {
  if (!id) {
    return '';
  }
  const spaced = id.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function deriveSourceDefaults(
  type: SourceType,
  location: string
): { id: string; name: string } {
  const rawSegment = extractRawSegment(location);

  let base = rawSegment;
  if (
    type === 'git-custom' ||
    type === 'git-marketplace' ||
    type === 'git-single-item'
  ) {
    base = base.replace(/\.git$/i, '');
  } else if (type === 'remote-url') {
    const lastDot = base.lastIndexOf('.');
    if (lastDot > 0) {
      base = base.slice(0, lastDot);
    }
  }

  const slug = slugify(base);
  const id = slug.length > 0 ? slug : 'source';
  const name = humanize(id);

  return { id, name };
}

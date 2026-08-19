import type { Package } from '../domain/types';

export interface DetectionDiagnostic {
  severity: 'error' | 'warning';
  path: string;
  message: string;
  code: 'invalid-frontmatter' | 'unsafe-path' | 'unreadable-skill';
}

export interface DetectedSkillDir {
  path: string;
  name: string;
  description?: string;
}

export interface DetectedAgentFile {
  path: string;
  name: string;
  description?: string;
}

export interface DetectedCommandFile {
  path: string;
  name: string;
  description?: string;
}

export interface DetectedMcpServer {
  id: string;
  type: string;
  command?: string;
  url?: string;
  description?: string;
  path: string;
}

export interface SkillDetectionResult {
  skills: DetectedSkillDir[];
  diagnostics: DetectionDiagnostic[];
}

export interface SourceResolution {
  packages: Package[];
  diagnostics: DetectionDiagnostic[];
}

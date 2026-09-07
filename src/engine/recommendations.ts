import type { Artifact, ManagedInstallation, Package, Source } from '../domain/types';
import type { DesiredInstallation } from '../domain/registry';

export type SourceResolutionAttempt =
  | { status: 'resolved'; source: Source; packages: Package[] }
  | { status: 'failed'; source: Source; error: string };

export type BrokenReason =
  | { kind: 'source-not-registered' }
  | { kind: 'source-resolution-failed'; error: string }
  | { kind: 'artifact-not-found' };

export function resolveRecommendations(
  desired: DesiredInstallation[],
  installed: ManagedInstallation[],
  registeredSources: Source[],
  resolutionAttempts: Map<string, SourceResolutionAttempt>
): {
  satisfied: DesiredInstallation[];
  pending: { desired: DesiredInstallation; artifact: Artifact; pkg: Package; source: Source }[];
  broken: { desired: DesiredInstallation; reason: BrokenReason }[];
} {
  const satisfied: DesiredInstallation[] = [];
  const pending: { desired: DesiredInstallation; artifact: Artifact; pkg: Package; source: Source }[] = [];
  const broken: { desired: DesiredInstallation; reason: BrokenReason }[] = [];

  for (const d of desired) {
    // 2. Matching key for satisfied is sourceId + artifactId + assistant
    const isInstalled = installed.some(
      (inst) => inst.sourceId === d.sourceId && inst.artifactId === d.artifactId && inst.assistant === d.assistant
    );

    if (isInstalled) {
      satisfied.push(d);
      continue;
    }

    // 3. For entries not in installed:
    const registeredSource = registeredSources.find((s) => s.id === d.sourceId);

    // If no entry in registeredSources has id === desired.sourceId -> broken with source-not-registered
    if (!registeredSource) {
      broken.push({ desired: d, reason: { kind: 'source-not-registered' } });
      continue;
    }

    const attempt = resolutionAttempts.get(d.sourceId);

    // Else if resolutionAttempts.get(desired.sourceId) is absent -> skip this entry
    if (!attempt) {
      continue;
    }

    // Else if that attempt has status: 'failed' -> broken with source-resolution-failed
    if (attempt.status === 'failed') {
      broken.push({ desired: d, reason: { kind: 'source-resolution-failed', error: attempt.error } });
      continue;
    }

    // Else (status: 'resolved'): search packages for an Artifact with id === desired.artifactId
    let foundArtifact: Artifact | undefined;
    let foundPackage: Package | undefined;

    for (const pkg of attempt.packages) {
      const artifact = pkg.artifacts.find((a) => a.id === d.artifactId);
      if (artifact) {
        foundArtifact = artifact;
        foundPackage = pkg;
        break;
      }
    }

    // found -> pending
    if (foundArtifact && foundPackage) {
      pending.push({
        desired: d,
        artifact: foundArtifact,
        pkg: foundPackage,
        source: attempt.source,
      });
    } else {
      // not found -> broken with artifact-not-found
      broken.push({ desired: d, reason: { kind: 'artifact-not-found' } });
    }
  }

  return { satisfied, pending, broken };
}

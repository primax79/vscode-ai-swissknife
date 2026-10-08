/**
 * Minimal, dependency-free unified diff generator with size capping.
 */
export interface DiffOptions {
  maxBytes?: number;
}

export function createUnifiedDiff(
  originalStr: string,
  localStr: string,
  originalHeader = 'original',
  localHeader = 'local',
  options: DiffOptions = {}
): string {
  const maxBytes = options.maxBytes ?? 50 * 1024; // 50KB default cap

  if (originalStr === localStr) {
    return '';
  }

  const origLines = originalStr.split('\n');
  const localLines = localStr.split('\n');

  // Compute LCS (Longest Common Subsequence) table
  const m = origLines.length;
  const n = localLines.length;

  // For very large files, avoid allocating massive matrices
  if (m * n > 250000) {
    // Fall back to a simplified diff representation if matrix would exceed 500x500
    const header = `--- ${originalHeader}\n+++ ${localHeader}\n@@ -1,${m} +1,${n} @@\n`;
    let result = header;
    for (const l of origLines.slice(0, 50)) {
      result += `-${l}\n`;
    }
    for (const l of localLines.slice(0, 50)) {
      result += `+${l}\n`;
    }
    result += '[...diff truncated due to size...]\n';
    return result;
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (origLines[i] === localLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to find diff edits
  type Edit = { type: 'keep' | 'delete' | 'insert'; line: string };
  const edits: Edit[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === localLines[j - 1]) {
      edits.unshift({ type: 'keep', line: origLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      edits.unshift({ type: 'insert', line: localLines[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      edits.unshift({ type: 'delete', line: origLines[i - 1] });
      i--;
    }
  }

  // Group into hunks with context
  let diffText = `--- ${originalHeader}\n+++ ${localHeader}\n`;
  let hunkText = `@@ -1,${m} +1,${n} @@\n`;
  for (const edit of edits) {
    let prefix = ' ';
    if (edit.type === 'delete') prefix = '-';
    else if (edit.type === 'insert') prefix = '+';
    hunkText += prefix + edit.line + '\n';
  }

  diffText += hunkText;

  if (Buffer.byteLength(diffText, 'utf-8') > maxBytes) {
    const buffer = Buffer.from(diffText, 'utf-8');
    const truncated = buffer.subarray(0, maxBytes).toString('utf-8');
    return truncated + '\n[...diff truncated at max size...]\n';
  }

  return diffText;
}

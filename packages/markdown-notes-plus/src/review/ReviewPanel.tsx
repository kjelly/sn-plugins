import React from "react";
import {
  type ReviewReport,
  type DiagnosticIssue,
} from "./ReviewDiagnostics.ts";

export interface ReviewPanelProps {
  report: ReviewReport;
  readOnly: boolean;
  onSelectHeading?: (anchor: number) => void;
  onAutoFix?: (issueId: string) => void;
  onFixAll?: () => void;
  onNormalizeBareUrls?: () => void;
  normalizeBareUrlsLabel?: string;
}

export function ReviewPanel({
  report,
  readOnly,
  onSelectHeading,
  onAutoFix,
  onFixAll,
  onNormalizeBareUrls,
  normalizeBareUrlsLabel = "Convert bare URLs to Markdown links",
}: ReviewPanelProps) {
  const { metrics, issues, healthScore } = report;
  const fixableIssues = issues.filter((i) => i.canAutoFix);

  const getScoreTier = (score: number): "good" | "warning" | "danger" => {
    if (score >= 90) return "good";
    if (score >= 70) return "warning";
    return "danger";
  };
  const scoreTier = getScoreTier(healthScore);

  const getSeverityIcon = (severity: DiagnosticIssue["severity"]) => {
    switch (severity) {
      case "error": return "🔴";
      case "warning": return "⚠️";
      case "info": return "ℹ️";
    }
  };

  return (
    <div className="review-panel pane-section" aria-label="Note Review and Health">
      <div className={`health-score-card tier-${scoreTier}`} data-score-tier={scoreTier}>
        <div className="health-score-header">
          <span className="health-score-title">Note Health Score</span>
          <span className="health-score-value">
            {healthScore} / 100
          </span>
        </div>
        <div className="health-score-bar">
          <div
            className="health-score-bar-fill"
            data-score={Math.min(100, Math.max(0, Math.round(healthScore / 5) * 5))}
          />
        </div>
      </div>

      <div className="review-metrics-grid">
        <div className="metric-box">
          <span className="metric-label">Size</span>
          <span className={`metric-value ${metrics.sizeLevel !== "normal" ? "metric-warning" : ""}`}>
            {Math.round(metrics.bytes / 1024)} KB
          </span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Words</span>
          <span className="metric-value">{metrics.words.toLocaleString()}</span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Headings</span>
          <span className="metric-value">{metrics.headingsCount}</span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Tasks</span>
          <span className="metric-value">
            {metrics.completedTasksCount} / {metrics.tasksCount}
          </span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Code Blocks</span>
          <span className="metric-value">{metrics.codeBlocksCount}</span>
        </div>
        <div className="metric-box">
          <span className="metric-label">Tables</span>
          <span className="metric-value">{metrics.tablesCount}</span>
        </div>
      </div>

      {metrics.largestSections.length > 0 ? (
        <div className="largest-sections-card">
          <h4>Largest Sections</h4>
          <ul className="largest-sections-list">
            {metrics.largestSections.map((sec) => (
              <li key={sec.anchor} className="largest-section-item">
                <button
                  type="button"
                  className="section-link-btn"
                  onClick={() => onSelectHeading?.(sec.anchor)}
                  title="Jump to section"
                >
                  <span className="section-title-text">{sec.title}</span>
                  <span className="section-size-text">
                    {Math.round(sec.bytes / 1024)} KB ({sec.percentage}%)
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="diagnostics-section">
        <div className="diagnostics-header">
          <h4>Diagnostics ({issues.length})</h4>
          {fixableIssues.length > 0 && !readOnly && onFixAll ? (
            <button
              type="button"
              className="btn-fix-all"
              onClick={onFixAll}
              title="Fix all safe structural issues automatically"
            >
              Fix All ({fixableIssues.length})
            </button>
          ) : null}
          {onNormalizeBareUrls ? (
            <button
              type="button"
              className="btn-diagnostic-action"
              disabled={readOnly}
              onClick={onNormalizeBareUrls}
              title="Convert bare URLs to Markdown links"
            >
              {normalizeBareUrlsLabel}
            </button>
          ) : null}
        </div>

        {issues.length === 0 ? (
          <p className="no-issues-hint">✓ No issues detected. Note structure is clean!</p>
        ) : (
          <ul className="diagnostics-list">
            {issues.map((issue) => (
              <li key={issue.id} className={`diagnostic-item severity-${issue.severity}`}>
                <div className="diagnostic-header-row">
                  <span className="diagnostic-icon">{getSeverityIcon(issue.severity)}</span>
                  <span className="diagnostic-category-badge">{issue.category}</span>
                  <span className="diagnostic-message">{issue.message}</span>
                </div>
                <div className="diagnostic-actions">
                  {typeof issue.anchor === "number" && onSelectHeading ? (
                    <button
                      type="button"
                      className="btn-diagnostic-action"
                      onClick={() => onSelectHeading(issue.anchor!)}
                      title="Jump to location"
                    >
                      Jump
                    </button>
                  ) : null}
                  {issue.canAutoFix && !readOnly && onAutoFix ? (
                    <button
                      type="button"
                      className="btn-diagnostic-action btn-quick-fix"
                      onClick={() => onAutoFix(issue.id)}
                      title="Quick Fix"
                    >
                      Quick Fix
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

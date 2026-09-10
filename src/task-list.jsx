import React from "react";
export const completedTask = (job) =>
  ["done", "cancelled"].includes(job.status);
export function TaskList({
  jobs = [],
  children,
  historyOnly = false,
  activeOnly = false,
}) {
  const active = jobs
    .filter((j) => !completedTask(j))
    .sort(
      (a, b) => Number(b.status === "running") - Number(a.status === "running"),
    );
  const done = jobs.filter(completedTask);
  return (
    <>
      {!historyOnly && active.map(children)}
      {!activeOnly && done.length > 0 && (
        <details className="task-history">
          <summary>已完成记录 · {done.length} 项</summary>
          {done.map(children)}
        </details>
      )}
    </>
  );
}

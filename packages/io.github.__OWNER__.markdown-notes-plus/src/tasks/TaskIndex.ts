import { analyzeMarkdown, deleteCompleted, deleteTask, toggleTask, uncheckAll, type TaskInfo } from "../markdown/analysis";

export type TaskProjection = { open: TaskInfo[]; completed: TaskInfo[] };

export function taskIndex(markdown: string): TaskProjection {
  const tasks = analyzeMarkdown(markdown).tasks;
  return { open: tasks.filter((task) => !task.checked), completed: tasks.filter((task) => task.checked) };
}

export const taskCommands = { toggleTask, deleteTask, uncheckAll, deleteCompleted };

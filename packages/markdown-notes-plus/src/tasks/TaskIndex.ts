import { analyzeMarkdown, deleteCompleted, deleteTask, toggleTask, uncheckAll, type TaskInfo } from "../markdown/analysis.ts";

export type TaskProjection = { open: TaskInfo[]; completed: TaskInfo[] };

export function taskIndex(markdown: string): TaskProjection {
  const tasks = analyzeMarkdown(markdown).tasks;
  return { open: tasks.filter((task) => !task.checked), completed: tasks.filter((task) => task.checked) };
}

export type TaskGroup = {
  headingPath: string[];
  title: string;
  tasks: TaskInfo[];
};

export function groupTasksByHeading(tasks: TaskInfo[]): TaskGroup[] {
  const groups: TaskGroup[] = [];
  const map = new Map<string, TaskGroup>();
  for (const task of tasks) {
    const key = task.headingPath.join(" / ");
    let group = map.get(key);
    if (!group) {
      group = {
        headingPath: task.headingPath,
        title: task.headingPath.length > 0 ? task.headingPath.join(" / ") : "General",
        tasks: [],
      };
      map.set(key, group);
      groups.push(group);
    }
    group.tasks.push(task);
  }
  return groups;
}

export const taskCommands = { toggleTask, deleteTask, uncheckAll, deleteCompleted };

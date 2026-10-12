export async function runCommand(
  command: string,
  options: { args?: string[]; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: Uint8Array; stderr: Uint8Array }> {
  const child = Bun.spawn([command, ...(options.args ?? [])], {
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).bytes(),
    new Response(child.stderr).bytes(),
  ]);
  return { code, stdout, stderr };
}

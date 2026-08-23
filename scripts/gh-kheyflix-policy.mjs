export const EXPECTED_REPOSITORY = "GDemay/Kheyflix";
export const ALLOWED_COMMANDS = new Set([
  "issue",
  "label",
  "pr",
  "release",
  "run",
  "workflow",
]);

export function protectedEnvironment(source, configDir) {
  const env = {
    ...source,
    GH_CONFIG_DIR: configDir,
    GH_REPO: EXPECTED_REPOSITORY,
  };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return env;
}

export function protectedArguments(args) {
  if (!args.length) throw new Error("no GitHub CLI command was provided.");
  if (!ALLOWED_COMMANDS.has(args[0]))
    throw new Error(`command \"${args[0]}\" is not allowed by the Kheyflix delivery gateway.`);
  if (
    args.some(
      (value) =>
        value === "--repo" ||
        value.startsWith("--repo=") ||
        value === "-R" ||
        value.startsWith("-R"),
    )
  )
    throw new Error("repository selectors are forbidden; the gateway pins GDemay/Kheyflix.");
  return [...args, "--repo", EXPECTED_REPOSITORY];
}

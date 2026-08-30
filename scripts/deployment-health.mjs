export const assertExpectedDeploymentCommit = (
  health,
  expectedCommit = process.env.EXPECTED_COMMIT,
) => {
  const expected = expectedCommit?.trim();
  if (!expected) return;
  const actual =
    typeof health?.deployment?.commit === "string"
      ? health.deployment.commit.trim()
      : "";
  if (actual !== expected)
    throw new Error(
      `Deployment commit mismatch: expected ${expected}, received ${actual || "none"}.`,
    );
};

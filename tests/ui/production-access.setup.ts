import { chmod, writeFile } from "node:fs/promises";

import { establishProductionAccess } from "../../scripts/production-access.mjs";
import { productionAccessStatePath } from "../../playwright.config";

const setupProductionAccess = async () => {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
  if (!baseUrl) return;
  const session = await establishProductionAccess(baseUrl);
  const [name, value] = session.split("=", 2);
  const origin = new URL(baseUrl);
  await writeFile(
    productionAccessStatePath,
    JSON.stringify({
      cookies: [
        {
          name,
          value,
          domain: origin.hostname,
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 600,
          httpOnly: true,
          secure: true,
          sameSite: "Strict",
        },
      ],
      origins: [],
    }),
    { mode: 0o600 },
  );
  await chmod(productionAccessStatePath, 0o600);
};

export default setupProductionAccess;

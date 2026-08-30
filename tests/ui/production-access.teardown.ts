import { rm } from "node:fs/promises";

import { productionAccessStatePath } from "../../playwright.config";

const teardownProductionAccess = async () => {
  await rm(productionAccessStatePath, { force: true });
};

export default teardownProductionAccess;

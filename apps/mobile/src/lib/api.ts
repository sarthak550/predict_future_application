import { createApiClient } from "@predict-future/api-client";

import { env } from "@/lib/env";

export const mobileApi = createApiClient({
  baseUrl: env.apiBaseUrl
});

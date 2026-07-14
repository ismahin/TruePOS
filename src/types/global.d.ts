import type { TruePOSApi } from "../shared/contracts";

declare global {
  interface Window {
    truePOS: TruePOSApi;
  }
}

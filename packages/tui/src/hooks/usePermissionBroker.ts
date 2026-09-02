import { useEffect, useState } from "react";
import {
  TuiPermissionBroker,
  type PendingPermissionRequest,
} from "../permission/TuiPermissionBroker.js";

/** Bridges TuiPermissionBroker's pub-sub into React state. */
export function usePermissionBroker(
  broker: TuiPermissionBroker
): PendingPermissionRequest | null {
  const [pending, setPending] = useState<PendingPermissionRequest | null>(null);
  useEffect(() => broker.subscribe(setPending), [broker]);
  return pending;
}
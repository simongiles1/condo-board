import { revalidatePath } from "next/cache";

/**
 * Drops cached V2 meeting list payloads so a new workspace appears after create, duplicate, rename, or delete.
 */
export function revalidateMeetingsWorkspaceList(): void {
  revalidatePath("/operations/meetings");
}

export const runtime = "nodejs";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { deleteEmailMessage } from "@/lib/email/delete-message";

type DeleteBody = {
  deleteFromDb?: boolean;
  deleteFromGmail?: boolean;
};

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: DeleteBody = {};
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const deleteFromDb = body.deleteFromDb === true;
  const deleteFromGmail = body.deleteFromGmail === true;

  if (!deleteFromDb && !deleteFromGmail) {
    return NextResponse.json(
      { error: "Choose at least one delete target." },
      { status: 400 },
    );
  }

  try {
    const result = await deleteEmailMessage(id, {
      deleteFromDb,
      deleteFromGmail,
    });

    revalidatePath("/emails");
    if (result.threadId) {
      revalidatePath(`/emails/${result.threadId}`);
    }

    const status = result.errors.length > 0 ? 207 : 200;
    return NextResponse.json(result, { status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not delete email.";

    if (message === "Email not found.") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    if (
      message.startsWith("Only messages synced") ||
      message.startsWith("Choose at least one")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("[email:messages:delete]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

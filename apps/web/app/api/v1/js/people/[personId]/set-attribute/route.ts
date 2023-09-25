import { getUpdatedState } from "@/app/api/v1/js/sync/lib/sync";
import { responses } from "@/lib/api/response";
import { transformErrorToDetails } from "@/lib/api/validator";
import { prisma } from "@formbricks/database";
import { createAttributeClass, getAttributeClassByNameCached } from "@formbricks/lib/services/attributeClass";
import { getPersonCached } from "@formbricks/lib/services/person";
import { ZJsPeopleAttributeInput } from "@formbricks/types/v1/js";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { getSessionCached, updateSessionTransientPerson } from "@formbricks/lib/services/session";
import { invalidateSurveys } from "@/app/api/v1/js/surveys";

export async function OPTIONS(): Promise<NextResponse> {
  return responses.successResponse({}, true);
}

export async function POST(req: Request, { params }): Promise<NextResponse> {
  try {
    const { personId } = params;
    const jsonInput = await req.json();

    // validate using zod
    const inputValidation = ZJsPeopleAttributeInput.safeParse(jsonInput);

    if (!inputValidation.success) {
      return responses.badRequestResponse(
        "Fields are missing or incorrectly formatted",
        transformErrorToDetails(inputValidation.error),
        true
      );
    }

    const { environmentId, sessionId, key, value } = inputValidation.data;

    let attributeClass = await getAttributeClassByNameCached(environmentId, key);

    // create new attribute class if not found
    if (attributeClass === null) {
      attributeClass = await createAttributeClass(environmentId, key, "code");
    }

    if (!attributeClass) {
      return responses.internalServerErrorResponse("Unable to create attribute class", true);
    }

    const existingPerson = await getPersonCached(personId);

    if (!existingPerson) {
      let session = await getSessionCached(sessionId);
      if (session && session.transPerson) {
        session.transPerson.attributes[key] = value;
        session = await updateSessionTransientPerson(sessionId, session.transPerson);
        session = await getSessionCached(sessionId);
        invalidateSurveys(environmentId, session!.transPerson!);
      }
      const state = await getUpdatedState(environmentId, personId, sessionId);
      if (session) {
        state.session = session;
      }
      return responses.successResponse({ ...state }, true);
    }

    // upsert attribute (update or create)
    await prisma.attribute.upsert({
      where: {
        attributeClassId_personId: {
          attributeClassId: attributeClass.id,
          personId,
        },
      },
      update: {
        value,
      },
      create: {
        attributeClass: {
          connect: {
            id: attributeClass.id,
          },
        },
        person: {
          connect: {
            id: personId,
          },
        },
        value,
      },
    });

    // revalidate person
    revalidateTag(personId);

    const state = await getUpdatedState(environmentId, personId, sessionId);

    return responses.successResponse({ ...state }, true);
  } catch (error) {
    console.error(error);
    return responses.internalServerErrorResponse(`Unable to complete request: ${error.message}`, true);
  }
}

import { createAttributeClass, getAttributeClassByNameCached } from "@formbricks/lib/attributeClass/service";
import { getPersonCached, updatePersonAttribute } from "@formbricks/lib/person/service";
import { getSessionCached, updateSessionTransientPerson } from "@formbricks/lib/session/service";
import { invalidateSurveys } from "@/app/api/v1/js/sync/lib/surveys";
import { getUpdatedState } from "@/app/api/v1/js/sync/lib/sync";
import { prisma } from "@formbricks/database";
import { revalidateTag } from "next/cache";
import { TJsState } from "@formbricks/types/v1/js";

export const setUserAttribute = async (
  environmentId: string,
  sessionId: string,
  personId: string,
  key: string,
  value: string,
  updateState: boolean
): Promise<TJsState | null> => {
  let attributeClass = await getAttributeClassByNameCached(environmentId, key);

  // create new attribute class if not found
  if (attributeClass === null) {
    attributeClass = await createAttributeClass(environmentId, key, "code");
  }

  if (!attributeClass) {
    throw new Error("Unable to create attribute class");
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
    if (updateState) {
      const state = await getUpdatedState(environmentId, personId, sessionId);
      if (session) {
        state.session = session;
      }
      return state;
    } else {
      return null;
    }
  }

  await updatePersonAttribute(personId, attributeClass.id, value);

  if (updateState) {
    return await getUpdatedState(environmentId, personId, sessionId);
  } else {
    return null;
  }
};

export const upsertUserAttribute = async (
  environmentId: string,
  personId: string,
  key: string,
  value: string
) => {
  let attributeClass = await getAttributeClassByNameCached(environmentId, key);

  // create new attribute class if not found
  if (attributeClass === null) {
    attributeClass = await createAttributeClass(environmentId, key, "code");
  }

  if (!attributeClass) {
    throw new Error("Unable to create attribute class");
  }

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

  revalidateTag(personId);
};

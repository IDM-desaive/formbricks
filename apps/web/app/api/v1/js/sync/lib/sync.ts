import { getSurveysCached } from "@/app/api/v1/js/surveys";
import { MAU_LIMIT } from "@formbricks/lib/constants";
import { getActionClassesCached } from "@formbricks/lib/services/actionClass";
import { getEnvironmentCached } from "@formbricks/lib/services/environment";
import {
  createPerson,
  getMonthlyActivePeopleCount,
  getOrCreatePersonByUserId,
  getPersonCached,
} from "@formbricks/lib/services/person";
import { getProductByEnvironmentIdCached } from "@formbricks/lib/services/product";
import { createSession, extendSession, getSessionCached } from "@formbricks/lib/services/session";
import { captureTelemetry } from "@formbricks/lib/telemetry";
import { TEnvironment } from "@formbricks/types/v1/environment";
import { TJsState } from "@formbricks/types/v1/js";
import { TPerson } from "@formbricks/types/v1/people";
import { TSession } from "@formbricks/types/v1/sessions";
import cuid2 from "@paralleldrive/cuid2";
import {
  setUserAttribute,
  upsertUserAttribute,
} from "@/app/api/v1/js/people/[personId]/set-attribute/lib/set-attribute";

const captureNewSessionTelemetry = async (jsVersion?: string): Promise<void> => {
  await captureTelemetry("session created", { jsVersion: jsVersion ?? "unknown" });
};

export const getUpdatedState = async (
  environmentId: string,
  personId?: string,
  sessionId?: string,
  jsVersion?: string,
  userId?: string | null,
  userAttributes?: any
): Promise<TJsState> => {
  let environment: TEnvironment | null;
  let person: TPerson;
  let session: TSession | null = null;

  // check if environment exists
  environment = await getEnvironmentCached(environmentId);

  if (!environment) {
    throw new Error("Environment does not exist");
  }

  // check if Monthly Active Users limit is reached
  let currentMau = 0;
  try {
    currentMau = await getMonthlyActivePeopleCount(environmentId);
  } catch (e) {
    console.error("Failed to retrieve mau", e);
  }

  const isMauLimitReached = currentMau >= MAU_LIMIT;
  if (isMauLimitReached) {
    const errorMessage = `Monthly Active Users limit reached in ${environmentId} (${currentMau}/${MAU_LIMIT})`;
    if (!personId || !sessionId) {
      // don't allow new people or sessions
      throw new Error(errorMessage);
    }
    const session = await getSessionCached(sessionId);
    if (!session) {
      // don't allow new sessions
      throw new Error(errorMessage);
    }
    // check if session was created this month (user already active this month)
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    if (new Date(session.createdAt) < firstDayOfMonth) {
      throw new Error(errorMessage);
    }
  }

  // 1st create the person (either in the database or in the session)
  if (!personId) {
    if (userId) {
      console.log("User id provided, retrieving or creating person for " + userId);
      person = await getOrCreatePersonByUserId(userId, environmentId);
      if (userAttributes) {
        for (let key in userAttributes) {
          person.attributes[key] = userAttributes[key];
          await upsertUserAttribute(environmentId, person.id, key, userAttributes[key]);
        }
      }
    } else {
      console.log("Creating transient person");
      let personId = userId ? userId : cuid2.createId();
      person = { id: personId, updatedAt: new Date(), createdAt: new Date(), attributes: {} };
      // create a new session
      session = await createSession(null, person);
      sessionId = session.id;
      if (userAttributes) {
        for (const key in userAttributes) {
          person.attributes[key] = userAttributes[key];
          await setUserAttribute(environmentId, sessionId, personId, key, userAttributes[key], false);
        }
      }
    }
  } else {
    // check if person exists
    const existingPerson = await getPersonCached(personId);
    if (!existingPerson) {
      if (sessionId) {
        console.log("Fetching cached user state");
        session = await getSessionCached(sessionId);
        person = session?.transPerson ?? (await createPerson(environmentId));
      } else {
        console.log("creating new person");
        person = await createPerson(environmentId);
        session = await createSession(person.id, null);
        sessionId = session.id;
      }
      if (userAttributes && session) {
        for (const key in userAttributes) {
          await setUserAttribute(environmentId, session.id, person.id, key, userAttributes[key], false);
        }
      }
    } else {
      person = existingPerson;
      if (userAttributes && sessionId) {
        for (const key in userAttributes) {
          await setUserAttribute(environmentId, sessionId, person.id, key, userAttributes[key], false);
        }
      }
    }
  }

  if (!sessionId) {
    // create a new session
    session = await createSession(person.id, null);
  } else {
    // check validity of person & session
    session = await getSessionCached(sessionId!);
    if (!session) {
      // create a new session
      let existingPerson = await getPersonCached(person.id);
      if (existingPerson) {
        session = await createSession(person.id, null);
      } else {
        session = await createSession(null, person);
      }
      captureNewSessionTelemetry(jsVersion);
    } else {
      let existingPerson = await getPersonCached(person.id);

      // check if session is expired
      if (session.expiresAt < new Date()) {
        // create a new session
        if (existingPerson) {
          session = await createSession(person.id, null);
        } else {
          session = await createSession(null, person);
        }
        captureNewSessionTelemetry(jsVersion);
      } else {
        // extend session (if about to expire)
        const isSessionAboutToExpire =
          new Date(session.expiresAt).getTime() - new Date().getTime() < 1000 * 60 * 10;

        if (isSessionAboutToExpire) {
          session = await extendSession(sessionId!);
        }
      }
    }
  }
  // we now have a valid person & session

  // get/create rest of the state
  const [surveys, noCodeActionClasses, product] = await Promise.all([
    getSurveysCached(environmentId, person),
    getActionClassesCached(environmentId),
    getProductByEnvironmentIdCached(environmentId),
  ]);

  if (!product) {
    throw new Error("Product not found");
  }

  // return state
  const state: TJsState = {
    person: person!,
    session,
    surveys,
    noCodeActionClasses: noCodeActionClasses.filter((actionClass) => actionClass.type === "noCode"),
    product,
  };

  return state;
};

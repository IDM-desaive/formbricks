import { responses } from "@/lib/api/response";
import { transformErrorToDetails } from "@/lib/api/validator";
import { sendToPipeline } from "@/lib/pipelines";
import { InvalidInputError } from "@formbricks/types/v1/errors";
import { capturePosthogEvent } from "@formbricks/lib/posthogServer";
import { createResponse } from "@formbricks/lib/services/response";
import { getSurvey } from "@formbricks/lib/services/survey";
import { getTeamDetails } from "@formbricks/lib/services/teamDetails";
import { TResponse, TResponseInput, ZResponseInput } from "@formbricks/types/v1/responses";
import { NextResponse } from "next/server";
import { UAParser } from "ua-parser-js";
import { createPersonWithId, getPerson } from "@formbricks/lib/services/person";
import { getSessionByTransientPersonId } from "@formbricks/lib/services/session";
import { setUserAttribute } from "@/app/api/v1/js/people/[personId]/set-attribute/lib/set-attribute";

export async function OPTIONS(): Promise<NextResponse> {
  return responses.successResponse({}, true);
}

export async function POST(request: Request): Promise<NextResponse> {
  const responseInput: TResponseInput = await request.json();
  const agent = UAParser(request.headers.get("user-agent"));
  const inputValidation = ZResponseInput.safeParse(responseInput);

  if (!inputValidation.success) {
    return responses.badRequestResponse(
      "Fields are missing or incorrectly formatted",
      transformErrorToDetails(inputValidation.error),
      true
    );
  }

  let survey;

  try {
    survey = await getSurvey(responseInput.surveyId);
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return responses.badRequestResponse(error.message);
    } else {
      return responses.internalServerErrorResponse(error.message);
    }
  }

  const teamDetails = await getTeamDetails(survey.environmentId);

  let response: TResponse;
  try {
    const meta = {
      url: responseInput?.meta?.url ?? "",
      userAgent: {
        browser: agent?.browser.name,
        device: agent?.device.type,
        os: agent?.os.name,
      },
    };

    if (responseInput.personId) {
      let person = await getPerson(responseInput.personId);
      if (person == null) {
        console.log("Persisting person " + responseInput.personId);
        const session = await getSessionByTransientPersonId(responseInput.personId);
        if (session && session.transPerson) {
          person = await createPersonWithId(survey.environmentId, session.transPerson.id);
          if (session.transPerson.attributes) {
            for (let key in session.transPerson.attributes) {
              const value = "" + session.transPerson.attributes[key];
              await setUserAttribute(survey.environmentId, session.id, person.id, key, value, false);
            }
          }
        }
      }
    }

    response = await createResponse({
      ...responseInput,
      meta,
    });
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return responses.badRequestResponse(error.message);
    } else {
      return responses.internalServerErrorResponse(error.message);
    }
  }

  sendToPipeline({
    event: "responseCreated",
    environmentId: survey.environmentId,
    surveyId: response.surveyId,
    response: response,
  });

  if (responseInput.finished) {
    sendToPipeline({
      event: "responseFinished",
      environmentId: survey.environmentId,
      surveyId: response.surveyId,
      response: response,
    });
  }

  if (teamDetails?.teamOwnerId) {
    await capturePosthogEvent(teamDetails.teamOwnerId, "response created", teamDetails.teamId, {
      surveyId: response.surveyId,
      surveyType: survey.type,
    });
  } else {
    console.warn("Posthog capture not possible. No team owner found");
  }

  return responses.successResponse(response, true);
}

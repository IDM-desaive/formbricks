import { responses } from "@/lib/api/response";
import { transformErrorToDetails } from "@/lib/api/validator";
import { ZJsPeopleAttributeInput } from "@formbricks/types/v1/js";
import { NextResponse } from "next/server";
import { setUserAttribute } from "@/app/api/v1/js/people/[personId]/set-attribute/lib/set-attribute";

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

    try {
      const state = await setUserAttribute(environmentId, sessionId, personId, key, value, true);
      return responses.successResponse({ ...state }, true);
    } catch (error) {
      console.error(error);
      return responses.internalServerErrorResponse(`Unable to complete request: ${error.message}`, true);
    }
  } catch (error) {
    console.error(error);
    return responses.internalServerErrorResponse(`Unable to complete request: ${error.message}`, true);
  }
}

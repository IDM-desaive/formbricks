import { TJsPeopleAttributeInput, TJsPeopleUserIdInput, TJsState } from "@formbricks/types/v1/js";
import { Config } from "./config";
import {
  AttributeAlreadyExistsError,
  MissingPersonError,
  NetworkError,
  Result,
  err,
  match,
  ok,
  okVoid,
} from "./errors";
import { Logger } from "./logger";
import { sync } from "./sync";
import { TPerson } from "@formbricks/types/v1/people";

const config = Config.getInstance();
const logger = Logger.getInstance();

export const updatePersonUserId = async (
  userId: string
): Promise<Result<TJsState, NetworkError | MissingPersonError>> => {
  if (!config.get().state.person || !config.get().state.person.id)
    return err({
      code: "missing_person",
      message: "Unable to update userId. No person set.",
    });

  const url = `${config.get().apiHost}/api/v1/js/people/${config.get().state.person.id}/set-user-id`;

  const input: TJsPeopleUserIdInput = {
    environmentId: config.get().environmentId,
    userId,
    sessionId: config.get().state.session.id,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const jsonRes = await res.json();

  if (!res.ok) {
    return err({
      code: "network_error",
      message: "Error updating person",
      status: res.status,
      url,
      responseMessage: jsonRes.message,
    });
  }

  return ok(jsonRes.data as TJsState);
};

export const updatePersonAttribute = async (
  key: string,
  value: string
): Promise<Result<TJsState, NetworkError | MissingPersonError>> => {
  if (!config.get().state.person || !config.get().state.person.id) {
    return err({
      code: "missing_person",
      message: "Unable to update attribute. No person set.",
    });
  }

  const input: TJsPeopleAttributeInput = {
    environmentId: config.get().environmentId,
    sessionId: config.get().state.session.id,
    key,
    value,
  };

  const res = await fetch(
    `${config.get().apiHost}/api/v1/js/people/${config.get().state.person.id}/set-attribute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    }
  );

  const resJson = await res.json();

  if (!res.ok) {
    return err({
      code: "network_error",
      status: res.status,
      message: "Error updating person",
      url: res.url,
      responseMessage: resJson.message,
    });
  }

  return ok(resJson.data as TJsState);
};

export const hasAttributeValue = (key: string, value: string): boolean => {
  if (config.get().state.person?.attributes?.[key] === value) {
    return true;
  }
  return false;
};

export const hasAttributeKey = (key: string): boolean => {
  if (config.get().state.person?.attributes?.[key]) {
    return true;
  }
  return false;
};

export const setPersonUserId = async (
  userId: string | number
): Promise<Result<void, NetworkError | MissingPersonError | AttributeAlreadyExistsError>> => {
  logger.debug("setting userId: " + userId);
  // check if attribute already exists with this value
  if (hasAttributeValue("userId", userId.toString())) {
    logger.debug("userId already set to this value. Skipping update.");
    return okVoid();
  }
  if (hasAttributeKey("userId")) {
    return err({
      code: "attribute_already_exists",
      message: "userId cannot be changed after it has been set. You need to reset first",
    });
  }
  const result = await updatePersonUserId(userId.toString());

  if (result.ok !== true) return err(result.error);

  const state = result.value;

  config.update({ state });

  return okVoid();
};

export const setPersonAttribute = async (
  key: string,
  value: any
): Promise<Result<void, NetworkError | MissingPersonError>> => {
  logger.debug("Setting attribute: " + key + " to value: " + value);
  // check if attribute already exists with this value
  if (hasAttributeValue(key, value.toString())) {
    logger.debug("Attribute already set to this value. Skipping update.");
    return okVoid();
  }

  const result = await updatePersonAttribute(key, value.toString());

  let error: NetworkError | MissingPersonError;

  match(
    result,
    (state) => {
      config.update({ state });
    },
    (err) => {
      // pass error to outer scope
      error = err;
    }
  );

  // @ts-ignore
  if (error) {
    return err(error);
  }

  return okVoid();
};

export const logoutPerson = async (): Promise<void> => {
  logger.debug("Resetting state");
  config.update({ state: undefined });
  config.disallowSync();
};

export const resetPerson = async (): Promise<Result<void, NetworkError>> => {
  logger.debug("Resetting state & getting new state from backend");
  await logoutPerson();
  try {
    config.allowSync();
    await sync();
    return okVoid();
  } catch (e) {
    // @ts-ignore
    return err(e);
  }
};

export const getPerson = (): TPerson => {
  return config.get().state.person;
};

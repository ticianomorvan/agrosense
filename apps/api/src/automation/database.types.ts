import type { Json } from "../lib/database.types";

/** Service RPCs introduced by the automation migrations. */
export type AutomationFunctions = {
  claim_weather_farm: { Args: { p_now?: string }; Returns: Json };
  fail_weather_schedule: {
    Args: { p_farm_id: string; p_token: string; p_now?: string };
    Returns: boolean;
  };
  configure_notification_contact: {
    Args: {
      p_owner_id: string;
      p_phone_number: string;
      p_consented_at: string;
      p_enabled: boolean;
    };
    Returns: boolean;
  };
  claim_notification: { Args: { p_now?: string }; Returns: Json };
  begin_notification_send: {
    Args: {
      p_id: string;
      p_token: string;
      p_phone_number_id: string;
      p_now?: string;
    };
    Returns: boolean;
  };
  complete_notification_send: {
    Args: {
      p_id: string;
      p_token: string;
      p_outcome: string;
      p_message_id: string | null;
      p_error_code: string | null;
      p_now?: string;
    };
    Returns: boolean;
  };
  record_notification_receipt: {
    Args: {
      p_phone_number_id: string;
      p_message_id: string;
      p_status: string;
      p_occurred_at: string;
      p_recipient: string | null;
      p_notification_id: string | null;
      p_token: string | null;
    };
    Returns: boolean;
  };
  get_farm_notification_status: { Args: { p_farm_id: string }; Returns: Json };
  start_automation_run: { Args: { p_task: string }; Returns: string };
  finish_automation_run: {
    Args: { p_id: string; p_succeeded: boolean; p_result: Json };
    Returns: boolean;
  };
};

import { initializeClientFromStorage, refreshStoredSession } from "./supabaseClient";

const REFRESH_ALARM_NAME = "swejobs_refresh_session";
const REFRESH_PERIOD_MINUTES = 45;

async function refreshSession() {
  const { client, error } = await initializeClientFromStorage();
  if (error || !client) {
    return;
  }
  await refreshStoredSession(client);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM_NAME, { periodInMinutes: REFRESH_PERIOD_MINUTES });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REFRESH_ALARM_NAME) return;
  await refreshSession();
});

import * as functions from "firebase-functions/v2";
import { handleGetCalendarData } from "./controller/competition";

functions.setGlobalOptions({
  memory: "512MiB",
  maxInstances: 2,
  timeoutSeconds: 60,
  region: "europe-west1",
});

// export const refreshCompetitionData = functions.https.onRequest(
//   { cors: true },
//   async (_, response) => {
//     const clubId = "0924130";

//     await handleGetCalendarData(clubId);

//     response.send("Success!");
//   }
// );

export const scheduleRefreshCompetitionData = functions.scheduler.onSchedule(
  // every 2 hours
  "0 */2 * * *",
  async () => {
    const clubId = "0924130";

    await handleGetCalendarData(clubId);
  }
);

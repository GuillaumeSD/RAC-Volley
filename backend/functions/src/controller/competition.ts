import axios, { AxiosRequestConfig } from "axios";
import { parse } from "parse5";
import { logError } from "../utils/logging";
import { Competition, Match } from "../types/competition";
import { isNotNull } from "../utils/helpers";
import { CustomDom, CustomNode } from "../types/parser";
import {
  bulkDeleteFirestore,
  bulkSetFirestore,
  firestoreDB,
} from "../utils/firestore";
import { Timestamp } from "firebase-admin/firestore";
import * as dayjs from "dayjs";
import "dayjs/locale/fr";
import * as customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.locale("fr");
dayjs.extend(customParseFormat);

export const handleGetCalendarData = async (clubId: string): Promise<void> => {
  const config: AxiosRequestConfig = {
    method: "GET",
    url: `https://www.ffvbbeach.org/ffvbapp/resu/planning_club_class.php?cnclub=${clubId}`,
  };
  const res = await axios(config);
  const resData = res.data as string;

  const competitionsUrl = resData
    .match(
      /https:\/\/www\.ffvbbeach\.org\/ffvbapp\/resu\/vbspo_calendrier\.php\?[\s\S]*?'/gm
    )
    ?.map((url) => url.slice(0, -1));

  if (!competitionsUrl?.length) return;

  const competitions = await Promise.all(
    competitionsUrl.map((url) => handleGetCompetitionData(url))
  );

  const validCompetitions = competitions.filter(isNotNull);

  const documentsToSet = validCompetitions.flatMap(
    formatCompetitionToFirestore
  );

  await bulkSetFirestore(documentsToSet);

  await deleteOutdatedMatches(validCompetitions);
};

const handleGetCompetitionData = async (
  url: string
): Promise<(Competition & { matches: Match[] }) | null> => {
  const config: AxiosRequestConfig = {
    method: "GET",
    url,
  };
  const res = await axios(config);

  const resData = res.data as string;
  const dom = parse(resData) as CustomDom;

  const html = dom.childNodes[0];
  const body = html.childNodes[2];

  const table = body.childNodes[7];
  const tbody: { childNodes: CustomNode[] } = table.childNodes[0];

  const trs = tbody.childNodes.filter(
    (child) => child.nodeName === "tr" && child.attrs.length > 0
  );

  const competitionData = getCompetitionMetadata(url, body);
  if (!competitionData) return null;

  const matchesData = trs.map((tr) => getMatchData(tr));

  return {
    ...competitionData,
    matches: matchesData.filter(isNotNull),
  };
};

const getCompetitionMetadata = (
  url: string,
  body: CustomNode
): Competition | null => {
  try {
    const ffvbId = url.match(/codent=(.*?)(&|$)/)?.[1];
    if (!ffvbId) {
      throw new Error("No competition ffvbId found");
    }
    const pool = url.match(/poule=(.*?)(&|$)/)?.[1];
    if (!pool) {
      throw new Error("No competition pool found");
    }
    const season = url.match(/saison=(.*?)(&|$)/)?.[1];
    if (!season) {
      throw new Error("No competition season found");
    }

    const table = body.childNodes[4];
    const tbody = table.childNodes[0];
    const tr = tbody.childNodes[1];
    const td = tr.childNodes[0];
    const name = td.childNodes[0].value;

    return { ffvbId, name, pool, season, url };
  } catch (error) {
    logError(error);
    return null;
  }
};

const getMatchData = (tr: { childNodes: CustomNode[] }): Match | null => {
  const tds = tr.childNodes.filter(
    (child) => child.nodeName === "td" && child.attrs.length > 0
  );

  const homeTeam = tds[3].childNodes[0].value;
  const awayTeam = tds[5].childNodes[0].value;

  if (homeTeam === "xxxxx" || awayTeam === "xxxxx") {
    return null;
  }

  if (
    !homeTeam.toLowerCase().includes("rueil") &&
    !awayTeam.toLowerCase().includes("rueil")
  ) {
    return null;
  }

  const ffvbId = tds.at(0)?.childNodes?.[0]?.value;
  if (!ffvbId) {
    throw new Error("No match ffvbId found");
  }

  const date = tds.at(1)?.childNodes?.[0]?.value;
  const time = tds.at(2)?.childNodes?.[0]?.value;

  let timestamp: Timestamp | undefined = undefined;

  if (date) {
    const dateMillis = dayjs(
      `${date} ${time ?? ""}`,
      ["DD/MM/YY HH:mm", "DD/MM/YY "],
      true
    ).valueOf();

    timestamp = Timestamp.fromMillis(dateMillis);
  }

  const setsPoint = tds.at(8)?.childNodes?.[0]?.value?.split(", ");

  const referee = tds.at(10)?.childNodes?.[0]?.value;

  const fileForm = tr.childNodes.at(11);
  const fileEndpoint = fileForm?.attrs?.at(2)?.value;
  const fileUrl = `https://www.ffvbbeach.org/ffvbapp${fileEndpoint?.slice(2)}`;

  const matchData: Match = {
    ffvbId,
    homeTeam,
    awayTeam,
    timestamp,
    date,
    time,
    setsPoint,
    referee,
    fileUrl,
  };

  return matchData;
};

const getCompetitionId = (competition: Competition) => {
  const { ffvbId, pool, season } = competition;
  return `${ffvbId}_${pool}_${season.replaceAll("/", "_")}`;
};

const formatCompetitionToFirestore = (
  competition: Competition & { matches: Match[] }
) => {
  const competitionId = getCompetitionId(competition);
  const { matches, ...competitionData } = competition;
  const documents = matches.map((match) => {
    const { ffvbId: matchId } = match;
    return {
      firestorePath: `competitions/${competitionId}/games/${matchId}`,
      data: match as unknown as Record<string, unknown>,
    };
  });
  return [
    {
      firestorePath: `competitions/${competitionId}`,
      data: competitionData,
    },
    ...documents,
  ];
};

const deleteOutdatedMatches = async (competitions: Competition[]) => {
  const competitionsIds = competitions.map(getCompetitionId);
  const getAllCollectionMatches = await firestoreDB
    .collectionGroup("games")
    .get();

  const documentsToDelete = getAllCollectionMatches.docs.filter((doc) => {
    doc.updateTime.toMillis() < Date.now() - 1000 * 60 * 5 &&
      competitionsIds.includes(doc.ref.parent.parent?.id ?? "");
  });
  console.log(`Deleting ${documentsToDelete.length} outdated games`);

  await bulkDeleteFirestore(documentsToDelete.map((doc) => doc.ref.path));
};

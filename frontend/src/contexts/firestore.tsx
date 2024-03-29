import { firestoreDB } from "@/helpers/firebase";
import { useFirestoreCollection } from "@/helpers/firestore";
import { GameEvent } from "@/types/calendar";
import { Competition, Game } from "@/types/firestore";
import dayjs from "dayjs";
import { collection, collectionGroup } from "firebase/firestore";
import { PropsWithChildren, createContext, useContext, useMemo } from "react";

export type FirestoreContextType = {
  gameEvents: GameEvent[];
  competitions: Competition[];
};

const FirestoreContext = createContext<Partial<FirestoreContextType>>({});

export function useFirestore() {
  return useContext(FirestoreContext);
}

export function FirestoreProvider({ children }: PropsWithChildren) {
  const games = useFirestoreCollection<Game>(
    collectionGroup(firestoreDB, "games")
  );
  const competitions = useFirestoreCollection<Competition>(
    collection(firestoreDB, "competitions")
  );

  const gameEvents: GameEvent[] = useMemo(
    () =>
      games.map((game) => {
        const competition = competitions.find(
          (competition) => competition.docId === game.collectionParentId
        );
        const dateMillis = game.timestamp?.toMillis();
        return {
          ...game,
          dayjs: dateMillis ? dayjs(dateMillis) : undefined,
          competition,
        };
      }),
    [games, competitions]
  );

  const value: FirestoreContextType = {
    gameEvents,
    competitions,
  };

  return (
    <FirestoreContext.Provider value={value}>
      {children}
    </FirestoreContext.Provider>
  );
}

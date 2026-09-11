import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleBind, handleStatus, handleUnbind, shutdownSeance } from "./server/seance";
import { seanceBind, seanceStatus, seanceUnbind } from "./shared/seance";

export default function contribute(server: PluginServerContext) {
  server.handle(seanceBind, handleBind);
  server.handle(seanceUnbind, handleUnbind);
  server.handle(seanceStatus, handleStatus);
  return () => {
    shutdownSeance();
  };
}
